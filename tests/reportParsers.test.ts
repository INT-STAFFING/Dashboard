process.env.TZ = 'Europe/Rome';

import { describe, expect, it, vi } from 'vitest';
import { parseFile } from '@/lib/parsers';
import { codeFor, parseAggregatore } from '@/lib/parsers/parseAggregatore';
import { parseReportBdo } from '@/lib/parsers/parseReportBdo';
import { parseReportPdc } from '@/lib/parsers/parseReportPdc';
import { parseReportRdi } from '@/lib/parsers/parseReportRdi';
import { parseVerbaliApertura } from '@/lib/parsers/parseVerbaliApertura';
import { workbook, type Cell } from './helpers/xlsx';

const OUR_RTI = 'RTI 7-26 Intellera';
const OTHER_RTI = 'RTI 8-26 Altro';
const noWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('codeFor', () => {
  it('maps the known professional figures to their short code, ignoring case, hyphens and spacing', () => {
    expect(codeFor('Health Care Consultant Junior')).toBe('HCJ');
    expect(codeFor('  business-consultant   SENIOR ')).toBe('BCS');
    expect(codeFor('Project-Manager')).toBe('PRJM');
    expect(codeFor('Program Manager')).toBe('PROM');
  });
  it('keeps an unknown figure as it is', () => {
    expect(codeFor('Data Scientist')).toBe('Data Scientist');
  });
});

describe('parseAggregatore', () => {
  const buf = workbook({
    'GdL - Gruppo di Lavoro': [
      ['Figure Professionali', 'GG / Uomo'],
      ['Health Care Consultant Junior', 10],
      ['Health Care Consultant Junior', 5],
      ['Project-Manager', 3],
      ['Data Scientist', 40],
      [null, 99],
    ],
    'Oggetto Fornitura': [
      ['File Sorgente', 'Modalità Fornitura', 'Subappalto SI/NO', 'Subappaltatore', 'Costo Totale Subappaltato', 'Fornitore'],
      ['f1.xlsx', 'A_corpo', 'No', null, 0, 'Accenture S.p.A.'],
      ['f1.xlsx', 'Tempo_materiali', 'Sì', 'Acme Srl', '1.500,50', null],
      ['f1.xlsx', 'Tempo_materiali', 'si', 'Beta Srl', 500, null],
      ['f2.xlsx', null, 'NO', null, 0, null],
      [null, 'A_corpo', 'NO', null, 0, null],
    ],
    'Generalità Intervento': [
      ['Numero IF', 'Titolo Intervento', 'File Sorgente', 'Ref. Fornitore - Mail', 'Codice Ultimo BDO', 'Macro Classe', 'Ref. ARIA - Nome Cognome', 'Ref. Fornitore - Nome Cognome', 'Importo Intervento', 'Data Assegnazione IF', 'Data Inizio Attività', 'Data Fine Attività'],
      [20260010, 'Uno', 'f1.xlsx', 'x@y.it', 2026330010, 3, 'Rossi Mario', 'Bianchi Luca', '€ 10.000,00', '01/01/2026', '15/01/2026', '30/06/2026'],
      [20260011, 'Due', 'f2.xlsx', 'mario@deloitte.com', null, null, null, null, 500, null, null, null],
      [20260012, null, 'f2.xlsx', null, null, null, null, null, 1, null, null, null],
    ],
  });

  it('builds the seniority distribution, largest first, with figure codes', () => {
    const { seniority } = parseAggregatore(buf);
    expect(seniority).toEqual([
      { figura: 'Data Scientist', code: 'Data Scientist', gg: 40, tariffa: null },
      { figura: 'Health Care Consultant Junior', code: 'HCJ', gg: 15, tariffa: null },
      { figura: 'Project-Manager', code: 'PRJM', gg: 3, tariffa: null },
    ]);
  });

  it('builds the interventi, enriched with modalità, subappalto and supplier from Oggetto Fornitura', () => {
    const { interventi } = parseAggregatore(buf);
    expect(interventi.map((i) => i.numero_if)).toEqual(['20260010', '20260011']);
    expect(interventi[0]).toMatchObject({
      titolo: 'Uno',
      bdo: '2026330010',
      has_bo: true,
      stato: 'approvato',
      ambito: 'Macro 3',
      fornitore: 'Accenture',
      ref_aria: 'Rossi Mario',
      ref_fornitore: 'Bianchi Luca',
      importo: 10000,
      modalita_if: 'A corpo + Tempo materiali',
      subappalto: true,
      subappaltatore: ['Acme Srl', 'Beta Srl'],
      costo_subappalto: 2000.5,
      data_assegnazione: '2026-01-01',
      data_inizio: '2026-01-15',
      data_fine: '2026-06-30',
    });
  });

  it('falls back sensibly when the supporting rows are missing', () => {
    const [, due] = parseAggregatore(buf).interventi;
    expect(due).toMatchObject({ fornitore: 'Deloitte', ambito: 'Altro', has_bo: false, stato: 'non elaborato', modalita_if: null, subappalto: false, subappaltatore: [], costo_subappalto: 0 });
  });

  it('carries no months and no revenue', () => {
    for (const i of parseAggregatore(buf).interventi) {
      expect(i.rev_mesi).toEqual(Array(12).fill(0));
      expect(i.revenue_anno).toBe(0);
    }
  });

  it('works with only some of the sheets, and with none', () => {
    expect(parseAggregatore(workbook({ 'GdL - Gruppo di Lavoro': [['Figure Professionali', 'GG / Uomo'], ['X', 1]] })).interventi).toEqual([]);
    expect(parseAggregatore(workbook({ Altro: [['x']] }))).toEqual({ seniority: [], interventi: [] });
  });

  it('is what parseFile returns for an Aggregatore file', () => {
    const out = parseFile('Aggregatore_Modulo_106.xlsx', buf);
    expect(out.kind).toBe('aggregatore');
    expect(out.interventi).toHaveLength(2);
    expect(out.seniority).toHaveLength(3);
  });
});

describe('parseReportBdo', () => {
  const head = ['Numero BDO', 'Descrizione BDO', 'Nome file PIF/IF', 'Descrizione PIF/IF', 'Codifica numerica documento', 'Stato del documento PIF/IF', 'Divisione', 'Centro di Costo', 'Ultima PIF/IF Approvata', 'Data caricamento', 'Utente caricamento doc BDO', 'Fornitore', 'ROI', 'Data invio ROI', 'Data approvazione ROI', 'Data rifiuto ROI', 'PMO', 'Data invio PMO', 'Data approvazione PMO', 'Data rifiuto PMO', 'CTRM', 'Data invio CTRM', 'Data approvazione CTRM', 'Data rifiuto CTRM', 'Versione corrente BDO', 'Data Versione corrente BDO', 'Data effettiva decorrenza BDO'];
  const row = (bdo: Cell): Cell[] => [bdo, 'Desc', 'file.pdf', 'PIF', 'C-1', 'Approvato', 'DIV', 'CC', 'SI', new Date(2026, 0, 5), 'utente', OUR_RTI, 'roi', new Date(2026, 0, 6), new Date(2026, 0, 7), null, 'pmo', new Date(2026, 0, 8), new Date(2026, 0, 9), null, 'ctrm', new Date(2026, 0, 10), new Date(2026, 0, 11), new Date(2026, 0, 12), '3', new Date(2026, 1, 1), new Date(2026, 1, 15)];

  it('maps every column of the workflow, dates included', () => {
    const [r] = parseReportBdo(workbook({ 'REPORT Bdo': [head, row('3300000001')] }));
    expect(r).toMatchObject({
      num_bdo: '3300000001',
      descrizione_bdo: 'Desc',
      stato_documento: 'Approvato',
      data_caricamento: '2026-01-05',
      roi: 'roi',
      data_invio_roi: '2026-01-06',
      data_approvazione_roi: '2026-01-07',
      data_rifiuto_roi: null,
      data_invio_pmo: '2026-01-08',
      data_approvazione_pmo: '2026-01-09',
      data_rifiuto_ctrm: '2026-01-12',
      versione_corrente: '3',
      data_versione_corrente: '2026-02-01',
      data_decorrenza: '2026-02-15',
    });
  });

  it('skips rows without a BDO and returns nothing without the sheet', () => {
    expect(parseReportBdo(workbook({ 'REPORT Bdo': [head, row(null), row('3300000002')] })).map((x) => x.num_bdo)).toEqual(['3300000002']);
    expect(parseReportBdo(workbook({ Altro: [['x']] }))).toEqual([]);
  });

  it('regressione: il Numero BDO numerico o float diventa una stringa intera', () => {
    const out = parseReportBdo(workbook({ 'REPORT Bdo': [head, row(3300000005), row('3300000006.0')] }));
    expect(out.map((x) => x.num_bdo)).toEqual(['3300000005', '3300000006']);
  });

  it('is recognised by its sheet name', () => {
    const out = parseFile('export_1.xlsx', workbook({ 'REPORT Bdo': [head, row('3300000001')] }));
    expect(out.kind).toBe('report_bdo');
    expect(out.reportBdo).toHaveLength(1);
  });
});

describe('parseReportRdi', () => {
  const head = ['Numero RDI', 'Descrizione RDI', 'Nome file PIF/IF', 'Codifica numerica documento', 'Stato del documento PIF/IF', 'Divisione', 'Centro di Costo', 'Ultima PIF/IF Approvata', 'Descrizione PIF/IF', 'Data caricamento', 'Utente caricamento doc IF', 'Fornitore', 'ROI', 'Data invio ROI', 'Data rifiuto ROI', 'Data approvazione ROI'];
  const row = (rdi: Cell): Cell[] => [rdi, 'Richiesta', 'f.pdf', 'C-9', 'In approvazione', 'DIV', 'CC', 'NO', 'PIF', new Date(2026, 2, 1), 'utente', OUR_RTI, 'roi', new Date(2026, 2, 2), null, new Date(2026, 2, 4)];

  it('maps the columns and reads the RDI number as an identifier', () => {
    const [r] = parseReportRdi(workbook({ 'REPORT Rdi': [head, row(55001.0)] }));
    expect(r).toMatchObject({
      numero_rdi: '55001',
      descrizione_rdi: 'Richiesta',
      stato_documento: 'In approvazione',
      data_caricamento: '2026-03-01',
      utente_caricamento: 'utente',
      data_invio_roi: '2026-03-02',
      data_rifiuto_roi: null,
      data_approvazione_roi: '2026-03-04',
    });
  });

  it('skips rows without an RDI, warns on missing headers, and is found by sheet name', () => {
    expect(parseReportRdi(workbook({ 'REPORT Rdi': [head, row(null)] }))).toEqual([]);
    const warn = noWarn();
    parseReportRdi(workbook({ 'REPORT Rdi': [['Numero RDI'], [1]] }));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(parseFile('export_2.xlsx', workbook({ 'REPORT Rdi': [head, row(1)] })).kind).toBe('report_rdi');
  });
});

describe('parseVerbaliApertura', () => {
  const head = ['Numero BDO', 'Descrizione', 'Nome del file', 'Codifica numerica documento', 'Stato Verbale', 'Periodo competenza', 'Divisione', 'Centro di Costo', 'Fornitore', 'Utente Caricamento Fornitore', 'Data firma fornitore', 'ROI', 'Data inserimento verbale ROI ma non sottomesso', 'Data sottomissione verbale ROI al fornitore', 'Data firma ROI', 'Data rifiuto ROI', 'Data invio ROI'];
  const row = (bdo: Cell, fornitore: string): Cell[] => [bdo, 'Apertura', 'a.pdf', 'A-1', 'Firmato', '2026-01', 'DIV', 'CC', fornitore, 'utente', new Date(2026, 0, 3), 'roi', null, new Date(2026, 0, 4), new Date(2026, 0, 5), null, new Date(2026, 0, 4)];

  it('keeps only our RTI and the rows with a BDO, mapping every column', () => {
    const rows = parseVerbaliApertura(workbook({ 'REPORT Apertura': [head, row(3300000001, OUR_RTI), row(3300000002, OTHER_RTI), row(null, OUR_RTI)] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      num_bdo: '3300000001',
      codifica_documento: 'A-1',
      stato_verbale: 'Firmato',
      periodo_competenza: '2026-01',
      data_firma_fornitore: '2026-01-03',
      data_inserimento_verbale_non_sottomesso: null,
      data_sottomissione_verbale_fornitore: '2026-01-04',
      data_firma_roi: '2026-01-05',
      data_invio_roi: '2026-01-04',
    });
  });

  it('is found by sheet name and empty without it', () => {
    expect(parseFile('export_3.xlsx', workbook({ 'REPORT Apertura': [head, row(3300000001, OUR_RTI)] })).kind).toBe('verbali_apertura');
    expect(parseVerbaliApertura(workbook({ Altro: [['x']] }))).toEqual([]);
  });
});

describe('parseReportPdc', () => {
  const head = ['Numero BDO', 'Posizione BDO', 'Descrizione Posizione', 'Importo Posizione', 'Codice PDC', 'Periodo PDC', 'Data Creazione', 'Utente caricamento', 'Codifica numerica documento', 'Stato della PDC', 'Divisione', 'Centro di Costo', 'Fornitore RTI', 'ROI', 'Data invio ROI', 'Data rifiuto ROI', 'Data approvazione ROI', 'Fornitore Prestazione', 'Service line', 'Tipo fornitura', 'RDI', 'Posizione RDI', 'Subappalto', 'Subappaltatore', 'Costo subappalto'];
  const row = (bdo: Cell, rti: string, importo: Cell = '€ 1.234,50'): Cell[] => [bdo, 10, 'Posizione', importo, 7001.0, '2026-02', new Date(2026, 1, 1), 'utente', 'P-1', 'Approvata', 'DIV', 'CC', rti, 'roi', new Date(2026, 1, 2), null, new Date(2026, 1, 3), 'Intellera', 'SL', 'Servizi', 55001, 1, 'SI', 'Acme', '100,25'];

  it('maps the columns, reading amounts and identifiers properly', () => {
    const [r] = parseReportPdc(workbook({ 'REPORT Pdc': [head, row(3300000001, OUR_RTI)] }));
    expect(r).toMatchObject({
      num_bdo: '3300000001',
      posizione_bdo: '10',
      importo_posizione: 1234.5,
      codice_pdc: '7001',
      periodo_pdc: '2026-02',
      data_creazione: '2026-02-01',
      stato_pdc: 'Approvata',
      fornitore_rti: OUR_RTI,
      data_invio_roi: '2026-02-02',
      data_rifiuto_roi: null,
      data_approvazione_roi: '2026-02-03',
      rdi: '55001',
      posizione_rdi: '1',
      subappalto: 'SI',
      subappaltatore: 'Acme',
      costo_subappalto: 100.25,
    });
  });

  it('keeps an absent amount as null (not 0), filters to our RTI, and drops rows without a BDO', () => {
    const rows = parseReportPdc(workbook({ 'REPORT Pdc': [head, row(3300000001, OUR_RTI, null), row(3300000002, OTHER_RTI), row(null, OUR_RTI)] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].importo_posizione).toBeNull();
  });

  it('is found by sheet name', () => {
    const out = parseFile('export_4.xlsx', workbook({ 'REPORT Pdc': [head, row(3300000001, OUR_RTI)] }));
    expect(out.kind).toBe('report_pdc');
    expect(out.reportPdc).toHaveLength(1);
  });
});
