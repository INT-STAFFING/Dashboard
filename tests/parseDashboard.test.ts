// Header dates are read in Rome time, like in production (see tests/parserUtil.test.ts).
process.env.TZ = 'Europe/Rome';

import { describe, expect, it } from 'vitest';
import { parseFile } from '@/lib/parsers';
import { parseDashboard } from '@/lib/parsers/parseDashboard';
import { workbook, type Cell } from './helpers/xlsx';

const DATI_HEAD = ['Numero IF', 'Costo Complessivo', 'Titolo Intervento', 'Fornitore', 'Modalità Fornitura', 'Subappalto SI/NO', 'Subappaltatore', 'Costo Totale Subappaltato', 'Data Inizio', 'Data Fine/Consegna', 'BO'];

const dati = (): Cell[][] => [
  ['DATI — milestone'],
  DATI_HEAD,
  [20260001, 1000, 'Intervento uno', 'Intellera Consulting', 'A_corpo', 'SI', 'Acme Srl', 100, '01/02/2026', '30/06/2026', 2026330001],
  [20260001, 500, 'Intervento uno', null, 'Tempo_e_materiali', 'NO', null, 0, '15/01/2026', '31/07/2026', null],
  [20260002, 800, 'Intervento due', 'Deloitte & Touche', null, 'NO', null, 0, null, null, null],
  [20260003, 50, null, 'Intellera', null, 'NO', null, 0, null, null, null], // no title: skipped
];

const timeline = (cols: Date[], rows: Cell[][]): Cell[][] => [['TIMELINE_REVENUE'], ['Numero IF', ...cols, 'Totale'], ...rows];

const MULTI_YEAR = workbook({
  DATI: dati(),
  TIMELINE_REVENUE: timeline(
    [new Date(2025, 11, 1), new Date(2026, 0, 1), new Date(2026, 1, 1), new Date(2027, 0, 1)],
    [
      [20260001, 10, 100, 50, 7, 167],
      [20260001, 0, 20, 0, 3, 23], // a second milestone row of the same IF: summed
      [20260002, 0, 0, 0, 0, 0], // all zero: no fact
      [20269999, 1, 1, 1, 1, 4], // not in DATI: ignored
    ],
  ),
  GIORNI_UOMO: [['x'], ['y'], ['Figura Professionale', 'GG / Uomo'], ['Project Manager', 10], ['Project Manager', 5], ['Developer', 20]],
});

describe('parseDashboard', () => {
  it('builds the interventi from DATI, aggregating the milestone rows of each IF', () => {
    const { interventi } = parseDashboard(MULTI_YEAR);
    expect(interventi.map((i) => i.numero_if)).toEqual(['20260001', '20260002']);
    expect(interventi[0]).toMatchObject({
      titolo: 'Intervento uno',
      importo: 1500,
      fornitore: 'Intellera',
      modalita_if: 'A corpo + Tempo e materiali',
      subappalto: true,
      subappaltatore: ['Acme Srl'],
      costo_subappalto: 100,
      bdo: '2026330001',
      has_bo: true,
      stato: 'approvato',
      data_inizio: '2026-01-15', // the earliest start
      data_fine: '2026-07-31', // the latest end
    });
    expect(interventi[1]).toMatchObject({ fornitore: 'Deloitte', has_bo: false, stato: 'non elaborato', subappalto: false });
  });

  it('REGRESSION (multi-year): reads the revenue of EVERY year in the sheet, not just 2026', () => {
    const { mesi } = parseDashboard(MULTI_YEAR);
    expect(mesi).toEqual(
      expect.arrayContaining([
        { numero_if: '20260001', anno: 2025, mese: 12, revenue: 10, consuntivo: 0 },
        { numero_if: '20260001', anno: 2026, mese: 1, revenue: 120, consuntivo: 0 }, // 100 + 20
        { numero_if: '20260001', anno: 2026, mese: 2, revenue: 50, consuntivo: 0 },
        { numero_if: '20260001', anno: 2027, mese: 1, revenue: 10, consuntivo: 0 }, // 7 + 3
      ]),
    );
    expect(mesi).toHaveLength(4);
  });

  it('the interventi themselves carry no months (they travel as facts)', () => {
    for (const i of parseDashboard(MULTI_YEAR).interventi) {
      expect(i.rev_mesi).toEqual(Array(12).fill(0));
      expect(i.cons_mesi).toEqual(Array(12).fill(0));
      expect(i.revenue_anno).toBe(0);
    }
  });

  it('ignores facts for IFs that are not in DATI, zero cells and non-date headers', () => {
    const { mesi } = parseDashboard(MULTI_YEAR);
    expect(mesi.some((f) => f.numero_if === '20269999')).toBe(false);
    expect(mesi.some((f) => f.numero_if === '20260002')).toBe(false);
    expect(mesi.every((f) => f.mese >= 1 && f.mese <= 12)).toBe(true); // "Totale" never becomes a month
  });

  it('REGRESSION: a classic single-year workbook yields the same 2026 months as before', () => {
    const buf = workbook({
      DATI: dati(),
      TIMELINE_REVENUE: timeline(
        Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1)),
        [[20260001, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 78]],
      ),
    });
    const { mesi } = parseDashboard(buf);
    expect(mesi.map((f) => [f.anno, f.mese, f.revenue])).toEqual(Array.from({ length: 12 }, (_, m) => [2026, m + 1, m + 1]));
  });

  it('a later year in the same sheet does not disturb the earlier ones', () => {
    const buf = workbook({
      DATI: dati(),
      TIMELINE_REVENUE: timeline([new Date(2026, 5, 1), new Date(2028, 5, 1)], [[20260001, 5, 9, 14]]),
    });
    expect(parseDashboard(buf).mesi).toEqual([
      { numero_if: '20260001', anno: 2026, mese: 6, revenue: 5, consuntivo: 0 },
      { numero_if: '20260001', anno: 2028, mese: 6, revenue: 9, consuntivo: 0 },
    ]);
  });

  it('reads seniority from GIORNI_UOMO, largest first', () => {
    const { seniority } = parseDashboard(MULTI_YEAR);
    expect(seniority.map((s) => [s.figura, s.gg])).toEqual([['Developer', 20], ['Project Manager', 15]]);
  });

  it('degrades gracefully: no timeline sheet, no DATI sheet', () => {
    expect(parseDashboard(workbook({ DATI: dati() })).mesi).toEqual([]);
    expect(parseDashboard(workbook({ DATI: dati() })).interventi).toHaveLength(2);
    expect(parseDashboard(workbook({ Altro: [['x']] }))).toEqual({ seniority: [], interventi: [], mesi: [] });
    expect(parseDashboard(workbook({ DATI: [['solo titolo'], ['senza colonna chiave']] }))).toEqual({ seniority: [], interventi: [], mesi: [] });
  });

  it('a timeline header without a "Numero IF" column yields nothing', () => {
    const buf = workbook({ DATI: dati(), TIMELINE_REVENUE: [['x'], ['Altro', new Date(2026, 0, 1)], [1, 5]] });
    expect(parseDashboard(buf).mesi).toEqual([]);
  });
});

describe('parseFile with the Dashboard workbook', () => {
  it('is recognised by its name and returns the facts', () => {
    const out = parseFile('Dashboard ARIA SISS.xlsx', MULTI_YEAR);
    expect(out.kind).toBe('dashboard');
    expect(out.mesi).toHaveLength(4);
    expect(out.interventi).toHaveLength(2);
    expect(out.seniority).toHaveLength(2);
  });

  it('is recognised by its sheets when the file name says nothing', () => {
    const out = parseFile('export_8f3a91.xlsx', MULTI_YEAR);
    expect(out.kind).toBe('dashboard');
    expect(out.mesi).toHaveLength(4);
  });
});
