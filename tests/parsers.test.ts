// Dates in the app are read in Rome time; see tests/parserUtil.test.ts.
process.env.TZ = 'Europe/Rome';

import { describe, expect, it, vi } from 'vitest';
import { detectKind, parseFile } from '@/lib/parsers';
import { parseBEF } from '@/lib/parsers/parseBEF';
import { parseChiusura } from '@/lib/parsers/parseChiusura';
import { parseIF } from '@/lib/parsers/parseIF';
import { parseVerbaliSal } from '@/lib/parsers/parseVerbaliSal';
import { workbook, type Cell } from './helpers/xlsx';

const IF_HEADERS = ['N° IF', 'N° BO', 'Titolo Intervento', 'Ambito', 'Fornitore', 'Ref. ARIA', 'Ref. Fornitore', 'Importo (€)', 'Modalità', 'Stato BO', 'PDC', 'V. Apertura', 'V. SAL', 'BEF', 'Data Inizio', 'Data Fine', 'Azione Richiesta'];

describe('detectKind', () => {
  it.each([
    ['IF_ARIA_SISS_2026.xlsx', 'if'],
    ['Monitoraggio_luglio.xlsx', 'if'],
    ['Dettaglio.xlsx', 'if'],
    ['REPORT_BEF.xlsx', 'bef'],
    ['Dashboard ARIA SISS.xlsx', 'dashboard'],
    ['Aggregatore.xlsx', 'aggregatore'],
    ['verbali_chiusura.xlsx', 'chiusura'],
    ['export_20260101.xlsx', 'unknown'],
  ])('%s -> %s', (name, kind) => {
    expect(detectKind(name)).toBe(kind);
  });
});

describe('parseIF', () => {
  const buf = workbook({
    '📋 Dettaglio IF': [
      ['Monitor IF — banner'],
      IF_HEADERS,
      [20260001, 2026330001, 'Titolo uno', 'Sviluppo', 'Intellera Consulting', 'Rossi', 'Bianchi', '€ 1.234,56', 'A corpo', 'BO emesso', '✅', '❌', '🔄', '—', '01/02/2026', new Date(2026, 1, 28), 'Verificare'],
      [20260002, null, 'Titolo due', 'ATT.IMM.', 'Deloitte & Touche', null, null, 5000, 'Tempo e materiali', 'BO non emesso', 'Mancante', 'OK', 'In corso', 'ok', null, null, null],
      [20260003, null, null, 'Sviluppo', 'Intellera', null, null, 10, null, null, null, null, null, null, null, null, null],
      [null, null, 'Senza numero', null, null, null, null, 10, null, null, null, null, null, null, null, null, null],
    ],
    '📝 Note Operative': [['banner'], ['N° IF', 'Note Operative'], [20260001, 'Nota operativa uno'], [20260002, null]],
  });

  it('maps a full row, normalising supplier, amount, statuses and dates', () => {
    const [a] = parseIF(buf);
    expect(a).toMatchObject({
      numero_if: '20260001',
      bdo: '2026330001',
      titolo: 'Titolo uno',
      ambito: 'Sviluppo',
      fornitore: 'Intellera',
      ref_aria: 'Rossi',
      ref_fornitore: 'Bianchi',
      importo: 1234.56,
      modalita_if: 'A corpo',
      has_bo: true,
      stato: 'approvato',
      attivazione: 'NO',
      pdc: 'ok',
      v_apertura: 'ko',
      v_sal: 'prog',
      bef: 'nd',
      data_inizio: '2026-02-01',
      data_fine: '2026-02-28', // a real date cell: must not slip a day in Rome time
      azione: 'Verificare',
      note_operative: 'Nota operativa uno',
      edited_manually: false,
    });
    expect(a.rev_mesi).toEqual(Array(12).fill(0));
  });

  it('derives BO and activation flags and recognises the other partners', () => {
    const b = parseIF(buf)[1];
    expect(b).toMatchObject({ numero_if: '20260002', fornitore: 'Deloitte', has_bo: false, stato: 'non elaborato', attivazione: 'SI', pdc: 'ko', v_apertura: 'ok', v_sal: 'prog', bef: 'ok', note_operative: null });
  });

  it('skips rows that miss the number or the title', () => {
    expect(parseIF(buf).map((i) => i.numero_if)).toEqual(['20260001', '20260002']);
  });

  it('returns nothing when the sheet is absent', () => {
    expect(parseIF(workbook({ Altro: [['x']] }))).toEqual([]);
  });

  it('REGRESSION: an IF stored in a date-formatted cell keeps its number', () => {
    const odd = workbook({
      '📋 Dettaglio IF': [['banner'], IF_HEADERS, [{ v: 20260323, z: 'dd/mm/yyyy' }, null, 'Titolo', ...Array(14).fill(null)]],
    });
    expect(parseIF(odd)[0].numero_if).toBe('20260323');
  });

  it('is what parseFile returns for an IF_ARIA file name', () => {
    const out = parseFile('IF_ARIA_SISS_2026.xlsx', buf);
    expect(out.kind).toBe('if');
    expect(out.interventi).toHaveLength(2);
  });
});

const BEF_HEADERS = ['Numero BDO', 'Descrizione', 'Numero Linea Ordine', 'Periodo Competenza', 'Fornitore RTI', 'Fornitore Reale', 'Importo Ricezione', 'Numero Fattura', 'Data Fattura', 'Data Pagamento'];
const OUR_RTI = 'RTI 7-26 Intellera';

describe('parseBEF', () => {
  const buf = workbook({
    'REPORT Bef': [
      BEF_HEADERS,
      [3300000001, 'Linea A', 1, '2026-01', OUR_RTI, 'Intellera', 1000.5, 9000012345, new Date(2026, 0, 5), null],
      [3300000001, 'Linea B', 2, '2026-01', OUR_RTI, 'Intellera', '€ 2.000,00', null, null, null],
      [3300000002, 'Altro RTI', 1, '2026-01', 'RTI 8-26 Altro', 'Altro', 500, 1, new Date(2026, 0, 1), null],
      [null, null, null, null, OUR_RTI, null, 10, null, null, null],
    ],
  });

  it('keeps only our RTI and maps amounts, invoice number and dates', () => {
    const rows = parseBEF(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      num_bdo: '3300000001',
      descrizione: 'Linea A',
      numero_linea_ordine: '1',
      periodo_competenza: '2026-01',
      fornitore_reale: 'Intellera',
      importo_ricezione: 1000.5,
      num_fattura: '9000012345',
      data_fattura: '2026-01-05', // first of the month neighbourhood: must stay in January
      data_pagamento: null,
    });
    expect(rows[1]).toMatchObject({ importo_ricezione: 2000, num_fattura: null, data_fattura: null });
  });

  it('REGRESSION: the invoice date at the start of a month stays in that month', () => {
    const first = workbook({ 'REPORT Bef': [BEF_HEADERS, [3300000001, 'X', 1, '2026-03', OUR_RTI, 'Intellera', 1, 1, new Date(2026, 2, 1), null]] });
    expect(parseBEF(first)[0].data_fattura).toBe('2026-03-01');
  });

  it('REGRESSION: tolerates header variants (case, spacing, accents) instead of silently reading nothing', () => {
    const variant = workbook({
      'REPORT Bef': [
        ['numero bdo', 'DESCRIZIONE', 'numero  linea ordine', 'periodo competenza', 'fornitore rti', 'fornitore reale', 'importo ricezione', 'NUMERO FATTURA', 'data fattura', 'data pagamento'],
        [3300000001, 'Linea', 1, '2026-01', OUR_RTI, 'Intellera', 10, 77, new Date(2026, 0, 9), new Date(2026, 1, 9)],
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [r] = parseBEF(variant);
    warn.mockRestore();
    expect(r).toMatchObject({ num_bdo: '3300000001', importo_ricezione: 10, num_fattura: '77', data_fattura: '2026-01-09', data_pagamento: '2026-02-09' });
  });

  it('REGRESSION: a numeric invoice number with a decimal tail loses it', () => {
    const f = workbook({ 'REPORT Bef': [BEF_HEADERS, [3300000001, 'X', 1.0, '2026-01', OUR_RTI, 'Intellera', 1, '9000012345.0', null, null]] });
    expect(parseBEF(f)[0]).toMatchObject({ num_fattura: '9000012345', numero_linea_ordine: '1' });
  });

  it('warns (without failing) when expected headers are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseBEF(workbook({ 'REPORT Bef': [['Numero BDO', 'Fornitore RTI', 'Importo Ricezione'], [3300000001, OUR_RTI, 5]] }));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns nothing without the sheet', () => {
    expect(parseBEF(workbook({ Foglio: [['x']] }))).toEqual([]);
  });
});

const SAL_HEADERS = ['Numero BDO', 'Descrizione', 'Nome file verbale SAL', 'Codifica numerica documento', 'Stato Verbale', 'Periodo competenza', 'Conforme', 'Motivo Conformità', 'Criticità', 'Motivazione Criticità', 'Livelli di Servizio Rispettati', 'Divisione', 'Centro di Costo', 'Fornitore', 'Utente Caricamento Fornitore', 'Data firma fornitore', 'ROI', 'Data inserimento verbale ROI ma non sottomesso', 'Data sottimissione verbale ROI al fornitore', 'Data firma ROI', 'Data rifiuto ROI', 'Data invio ROI'];

describe('parseVerbaliSal / content sniffing', () => {
  const salRow = (bdo: number | null, fornitore: string): Cell[] => [bdo, 'Verbale', 'sal.pdf', 'C-1', 'Firmato', '2026-01', 'SI', null, null, null, 'SI', 'DIV', 'CC1', fornitore, 'utente', new Date(2026, 1, 1), 'roi', null, new Date(2026, 1, 2), new Date(2026, 1, 3), null, new Date(2026, 1, 2)];
  const buf = workbook({
    'Richiesta 2026': [['intro']],
    'REPORT Sal': [SAL_HEADERS, salRow(3300000001, OUR_RTI), salRow(3300000002, 'RTI 8-26 Altro'), salRow(null, OUR_RTI)],
  });

  it('imports our RTI rows that carry a BDO, reading the misspelled "sottimissione" column', () => {
    const rows = parseVerbaliSal(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      num_bdo: '3300000001',
      stato_verbale: 'Firmato',
      codifica_documento: 'C-1',
      data_firma_fornitore: '2026-02-01',
      data_sottomissione_verbale_fornitore: '2026-02-02',
      data_firma_roi: '2026-02-03',
      data_invio_roi: '2026-02-02',
      data_rifiuto_roi: null,
    });
  });

  it('is recognised by its sheet even when the file name says nothing (system-generated names)', () => {
    const out = parseFile('export_8f3a91.xlsx', buf);
    expect(out.kind).toBe('verbali_sal');
    expect(out.verbaliSal).toHaveLength(1);
  });

  it('reports "unknown" for an unrecognised workbook and for something that is not a spreadsheet', () => {
    expect(parseFile('qualcosa.xlsx', workbook({ Foglio1: [['a', 'b']] })).kind).toBe('unknown');
    expect(parseFile('rumore.xlsx', Buffer.from('questo non è un excel')).kind).toBe('unknown');
  });
});

describe('parseChiusura', () => {
  it('keeps our RTI rows with a BDO or a description', () => {
    const buf = workbook({
      'REPORT Chiusura': [
        ['Numero BDO', 'Descrizione', 'Stato Verbale', 'Fornitore', 'ROI', 'Data firma ROI'],
        [3300000001, 'Chiusura A', 'Firmato', OUR_RTI, 'roi', new Date(2026, 5, 30)],
        [null, null, 'Firmato', OUR_RTI, 'roi', null],
        [3300000009, 'Altro', 'Firmato', 'RTI 8-26 Altro', 'roi', null],
      ],
    });
    const rows = parseChiusura(buf);
    expect(rows).toEqual([{ num_bdo: '3300000001', descrizione: 'Chiusura A', stato_verbale: 'Firmato', fornitore: OUR_RTI, roi: 'roi', data_firma_roi: '2026-06-30' }]);
  });
});
