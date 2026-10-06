import { describe, expect, it } from 'vitest';
import {
  AMBITO_NON_CLASSIFICATO,
  computeKpi,
  distribuzioneAmbito,
  filterInterventi,
  fornitoreTimeline,
  fornitoreTimelineMulti,
  impegnatoPerPartner,
  isIntellera,
  matchesMod,
  revenueMensile,
  rtiSummary,
} from '@/lib/queries';
import type { RtiConfig } from '@/lib/types';
import { makeIf } from './helpers/fixtures';

const rti = (ceiling: number, names: string[]) =>
  ({ ceiling, partners: names.map((name) => ({ name })), tot_impegnato: 0, erosione_2026: 0 }) as unknown as RtiConfig;

const ids = (list: { numero_if: string }[]) => list.map((i) => i.numero_if);

describe('isIntellera', () => {
  it.each([
    ['Intellera', true],
    ['Intellera Consulting S.r.l.', true],
    ['INTELLERA', true],
    ['Deloitte', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%j -> %s', (v, expected) => {
    expect(isIntellera(v as string | null | undefined)).toBe(expected);
  });
});

describe('filterInterventi', () => {
  const a = makeIf({ numero_if: 'A', fornitore: 'Intellera', ambito: 'Sviluppo', stato: 'approvato', has_bo: true, ref_aria: 'Rossi', ref_fornitore: 'Verdi', modalita_if: 'A corpo', attivazione: 'SI' });
  const b = makeIf({ numero_if: 'B', fornitore: 'Deloitte', ambito: null, stato: 'non elaborato', ref_aria: 'Bianchi', modalita_if: 'Tempo e materiali', subappalto: true });
  const c = makeIf({ numero_if: 'C', fornitore: 'Intellera', ambito: 'Governance', stato: 'non elaborato', ref_aria: 'Rossi', modalita_if: null });
  const all = [a, b, c];

  it('with no filters (or empty ones) returns everything', () => {
    expect(ids(filterInterventi(all, {}))).toEqual(['A', 'B', 'C']);
    expect(ids(filterInterventi(all, { forn: [], amb: [], stato: [] }))).toEqual(['A', 'B', 'C']);
  });

  it('is OR within a multi-select dimension', () => {
    expect(ids(filterInterventi(all, { forn: ['Intellera', 'Deloitte'] }))).toEqual(['A', 'B', 'C']);
    expect(ids(filterInterventi(all, { ref: ['Rossi', 'Bianchi'] }))).toEqual(['A', 'B', 'C']);
  });

  it('is AND across dimensions', () => {
    expect(ids(filterInterventi(all, { forn: ['Intellera'], ref: ['Rossi'], amb: ['Governance'] }))).toEqual(['C']);
    expect(ids(filterInterventi(all, { forn: ['Deloitte'], amb: ['Governance'] }))).toEqual([]);
  });

  it('filters the Referente Intellera dimension and the Stato dimension', () => {
    expect(ids(filterInterventi(all, { refint: ['Verdi'] }))).toEqual(['A']);
    expect(ids(filterInterventi(all, { stato: ['approvato'] }))).toEqual(['A']);
  });

  it('a null ambito is selectable under the "Non classificato" label', () => {
    expect(ids(filterInterventi(all, { amb: [AMBITO_NON_CLASSIFICATO] }))).toEqual(['B']);
  });

  it('a row with a null value never matches a non-empty selection', () => {
    expect(ids(filterInterventi(all, { ref: ['Rossi'] }))).toEqual(['A', 'C']);
    expect(ids(filterInterventi(all, { refint: ['Verdi'] }))).toEqual(['A']);
  });

  it('matches the modalità fuzzily, keeping the original "contains" logic', () => {
    expect(ids(filterInterventi(all, { mod: 'A corpo' }))).toEqual(['A']);
    expect(ids(filterInterventi(all, { mod: 'A tempo' }))).toEqual(['B']);
    expect(matchesMod(null, 'A corpo')).toBe(false);
    expect(matchesMod('A CORPO', 'a corpo')).toBe(true);
  });

  it('applies the single-value toggles (attivazione, BO emesso, subappalto)', () => {
    expect(ids(filterInterventi(all, { att: 'SI' }))).toEqual(['A']);
    expect(ids(filterInterventi(all, { bo: 'SI' }))).toEqual(['A']);
    expect(ids(filterInterventi(all, { sub: 'SI' }))).toEqual(['B']);
  });

  it('does not mutate the input', () => {
    const copy = [...all];
    filterInterventi(all, { forn: ['Intellera'] });
    expect(all).toEqual(copy);
  });
});

describe('computeKpi', () => {
  it('totals, average, BO split and partner counts', () => {
    const kpi = computeKpi([
      makeIf({ importo: 100, has_bo: true, fornitore: 'Intellera' }),
      makeIf({ importo: 200, has_bo: false, fornitore: 'Deloitte' }),
      makeIf({ importo: 300, has_bo: true, fornitore: 'Accenture' }),
    ]);
    expect(kpi).toEqual({ count: 3, totale: 600, medio: 200, bo_emessi: 2, bo_attesa: 1, intellera: 1, deloitte: 1 });
  });

  it('is all zeros (no division by zero) for an empty list', () => {
    expect(computeKpi([])).toEqual({ count: 0, totale: 0, medio: 0, bo_emessi: 0, bo_attesa: 0, intellera: 0, deloitte: 0 });
  });
});

describe('revenueMensile', () => {
  const jan = (n: number) => [n, ...Array(11).fill(0)];

  it('returns 12 months labelled Gen..Dic keyed 2026-01..2026-12', () => {
    const r = revenueMensile([], 2026);
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ mese: '2026-01', label: 'Gen', intellera: 0, deloitte: 0 });
    expect(r[11]).toMatchObject({ mese: '2026-12', label: 'Dic' });
  });

  it('REGRESSION: the month key follows the requested year instead of a hardcoded 2026', () => {
    const r = revenueMensile([], 2027);
    expect(r[0].mese).toBe('2027-01');
    expect(r[11].mese).toBe('2027-12');
    expect(revenueMensile([], 2019)[5].mese).toBe('2019-06');
  });

  it('sums per partner and ignores every other fornitore', () => {
    const r = revenueMensile([
      makeIf({ fornitore: 'Intellera', rev_mesi: jan(10) }),
      makeIf({ fornitore: 'Intellera', rev_mesi: jan(5) }),
      makeIf({ fornitore: 'Deloitte', rev_mesi: jan(7) }),
      makeIf({ fornitore: 'Accenture', rev_mesi: jan(1000) }),
    ], 2026);
    expect(r[0]).toMatchObject({ intellera: 15, deloitte: 7 });
  });

  it('tolerates a missing or short profile', () => {
    const r = revenueMensile([makeIf({ rev_mesi: null as unknown as number[] }), makeIf({ rev_mesi: [4] })], 2026);
    expect(r[0].intellera).toBe(4);
    expect(r[1].intellera).toBe(0);
  });
});

describe('distribuzioneAmbito', () => {
  it('groups by ambito, labels the empty one and sorts by value descending', () => {
    const d = distribuzioneAmbito([
      makeIf({ ambito: 'A', importo: 10 }),
      makeIf({ ambito: 'B', importo: 50 }),
      makeIf({ ambito: 'A', importo: 15 }),
      makeIf({ ambito: null, importo: 30 }),
    ]);
    expect(d).toEqual([
      { ambito: 'B', count: 1, valore: 50 },
      { ambito: 'Non classificato', count: 1, valore: 30 },
      { ambito: 'A', count: 2, valore: 25 },
    ]);
  });
});

describe('impegnatoPerPartner / rtiSummary', () => {
  const list = [makeIf({ fornitore: 'Intellera', importo: 100 }), makeIf({ fornitore: 'Deloitte', importo: 50 }), makeIf({ fornitore: 'Altro', importo: 999 })];

  it('sums only the configured partners, listing all of them even at zero', () => {
    expect(impegnatoPerPartner(list, rti(1000, ['Intellera', 'Deloitte', 'Gellify']))).toEqual({ Intellera: 100, Deloitte: 50, Gellify: 0 });
  });

  it('computes the erosion against the ceiling', () => {
    const s = rtiSummary(list, rti(2000, ['Intellera']));
    expect(s.impegnato).toBe(1149);
    expect(s.massimale).toBe(2000);
    expect(s.erosione_pct).toBeCloseTo(57.45, 2);
  });

  it('a zero ceiling gives 0% instead of Infinity/NaN', () => {
    expect(rtiSummary(list, rti(0, ['Intellera'])).erosione_pct).toBe(0);
  });
});

describe('fornitoreTimelineMulti', () => {
  const f = (numero_if: string, anno: number, mese: number, revenue: number, consuntivo = 0) => ({ numero_if, anno, mese, revenue, consuntivo });
  const ifs = [
    { numero_if: 'A', fornitore: 'Intellera' },
    { numero_if: 'B', fornitore: 'Intellera Consulting' },
    { numero_if: 'D', fornitore: 'Deloitte' },
  ];

  it('builds a complete 12-month series for every year that has data, ascending', () => {
    const t = fornitoreTimelineMulti([f('A', 2027, 3, 5), f('A', 2025, 1, 10, 4), f('B', 2025, 1, 2)], ifs);
    expect(t.years).toEqual([2025, 2027]);
    expect(t.months).toHaveLength(24);
    expect(t.months[0]).toEqual({ anno: 2025, mese: 1, revenue: 12, consuntivato: 4 });
    expect(t.months[12 + 2]).toEqual({ anno: 2027, mese: 3, revenue: 5, consuntivato: 0 });
    expect(t.months.filter((m) => m.anno === 2025)).toHaveLength(12);
  });

  it('only counts the matching supplier and IFs that are still in the portfolio', () => {
    const t = fornitoreTimelineMulti([f('A', 2026, 1, 1), f('D', 2026, 1, 999), f('GONE', 2026, 1, 999)], ifs);
    expect(t.months[0].revenue).toBe(1);
  });

  it('a year only the other suppliers have data for does not appear at all', () => {
    expect(fornitoreTimelineMulti([f('D', 2030, 1, 5)], ifs)).toEqual({ months: [], years: [] });
  });

  it('accepts a custom matcher and ignores out-of-range months', () => {
    const t = fornitoreTimelineMulti([f('D', 2026, 2, 8), f('D', 2026, 13, 100)], ifs, (n) => n === 'Deloitte');
    expect(t.months[1].revenue).toBe(8);
    expect(t.months.reduce((s, m) => s + m.revenue, 0)).toBe(8);
  });

  it('is empty with no facts', () => {
    expect(fornitoreTimelineMulti([], ifs)).toEqual({ months: [], years: [] });
  });
});

describe('fornitoreTimeline', () => {
  const p = (m: number, v: number) => Array.from({ length: 12 }, (_, i) => (i === m ? v : 0));

  it('sums the profiles of the matching supplier only, anchored to the year', () => {
    const t = fornitoreTimeline(
      [
        makeIf({ fornitore: 'Intellera', rev_mesi: p(0, 10), cons_mesi: p(0, 4) }),
        makeIf({ fornitore: 'Intellera Consulting', rev_mesi: p(0, 5), cons_mesi: p(2, 1) }),
        makeIf({ fornitore: 'Deloitte', rev_mesi: p(0, 999), cons_mesi: p(0, 999) }),
      ],
      2026,
    );
    expect(t.years).toEqual([2026]);
    expect(t.months).toHaveLength(12);
    expect(t.months[0]).toEqual({ anno: 2026, mese: 1, revenue: 15, consuntivato: 4 });
    expect(t.months[2]).toEqual({ anno: 2026, mese: 3, revenue: 0, consuntivato: 1 });
  });

  it('accepts a custom matcher', () => {
    const t = fornitoreTimeline([makeIf({ fornitore: 'Deloitte', rev_mesi: p(1, 8) })], 2025, (f) => f === 'Deloitte');
    expect(t.months[1].revenue).toBe(8);
  });
});
