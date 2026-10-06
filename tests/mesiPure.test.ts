import { describe, expect, it } from 'vitest';
import {
  ANNO_MAX,
  ANNO_MIN,
  factsToMap,
  isValidAnno,
  normalizeFacts,
  overlayMesi,
  parseAnno,
  pickDefaultAnno,
  profileFacts,
  sum12,
  v12,
  yearsOf,
} from '@/lib/mesiStore';
import type { MonthFact } from '@/lib/types';
import { makeIf } from './helpers/fixtures';

const f = (numero_if: string, anno: number, mese: number, revenue: number, consuntivo = 0): MonthFact => ({ numero_if, anno, mese, revenue, consuntivo });
const at = (y: number) => new Date(y, 5, 15);

describe('isValidAnno / parseAnno', () => {
  it('accepts whole years in the supported range', () => {
    expect(ANNO_MIN).toBe(2000);
    expect(ANNO_MAX).toBe(2100);
    for (const y of [2000, 2026, 2100]) expect(isValidAnno(y)).toBe(true);
  });

  it.each([1999, 2101, 2026.5, NaN, Infinity, '2026', null, undefined, {}])('rejects %j', (v) => {
    expect(isValidAnno(v)).toBe(false);
  });

  it('parseAnno also reads numeric strings (query strings, JSON) and nothing else', () => {
    expect(parseAnno('2026')).toBe(2026);
    expect(parseAnno(' 2026 ')).toBe(2026);
    expect(parseAnno(2027)).toBe(2027);
    for (const v of ['abc', '', '  ', '1999', '2026.5', '20x6', null, undefined, [], {}, true]) expect(parseAnno(v)).toBeNull();
  });
});

describe('pickDefaultAnno — which year to show when none is asked for', () => {
  it('is the current year when there is no data at all', () => {
    expect(pickDefaultAnno([], at(2026))).toBe(2026);
  });

  it('is the current year when it has data, whatever else exists', () => {
    expect(pickDefaultAnno([2025, 2026, 2027], at(2026))).toBe(2026);
    expect(pickDefaultAnno([2026], at(2026))).toBe(2026);
  });

  it('otherwise the closest earlier year with data', () => {
    expect(pickDefaultAnno([2023, 2025], at(2026))).toBe(2025);
    expect(pickDefaultAnno([2024, 2028], at(2026))).toBe(2024);
  });

  it('otherwise the closest later year', () => {
    expect(pickDefaultAnno([2029, 2027], at(2026))).toBe(2027);
  });

  it('does not depend on the order of the input and does not mutate it', () => {
    const years = [2027, 2024, 2025];
    expect(pickDefaultAnno(years, at(2026))).toBe(2025);
    expect(years).toEqual([2027, 2024, 2025]);
  });

  it('REGRESSION: rolls over on its own when the calendar year changes', () => {
    expect(pickDefaultAnno([2026, 2027], new Date(2026, 11, 31))).toBe(2026);
    expect(pickDefaultAnno([2026, 2027], new Date(2027, 0, 1))).toBe(2027);
    // On 1 January with no data for the new year yet, the latest year that has data stays on screen
    // instead of an empty one.
    expect(pickDefaultAnno([2026], new Date(2027, 0, 1))).toBe(2026);
  });
});

describe('v12 / sum12', () => {
  it('normalises anything into 12 finite numbers', () => {
    expect(v12(null)).toEqual(Array(12).fill(0));
    expect(v12([1, 2, 3]).slice(0, 4)).toEqual([1, 2, 3, 0]);
    expect(v12(['5', 'x', NaN, Infinity, null, undefined, 7])).toEqual([5, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0]);
    expect(v12(Array(20).fill(1))).toHaveLength(12);
  });

  it('sums rounded to the 4 decimals the database keeps (no float noise)', () => {
    expect(sum12([0.1, 0.2, ...Array(10).fill(0)])).toBe(0.3);
    expect(sum12(Array(12).fill(1.00005))).toBe(12.0006);
  });
});

describe('yearsOf / factsToMap', () => {
  const facts = [f('A', 2027, 1, 1), f('A', 2025, 1, 1), f('B', 2025, 2, 1), f('A', 2027, 2, 1)];

  it('lists the distinct years ascending', () => {
    expect(yearsOf(facts)).toEqual([2025, 2027]);
    expect(yearsOf([])).toEqual([]);
  });

  it('builds the 12-month arrays of one year per IF, ignoring other years and bad months', () => {
    const m = factsToMap([...facts, f('A', 2025, 13, 99), f('A', 2025, 0, 99)], 2025);
    expect([...m.keys()].sort()).toEqual(['A', 'B']);
    expect(m.get('A')!.rev[0]).toBe(1);
    expect(m.get('B')!.rev[1]).toBe(1);
    expect(m.get('A')!.rev.reduce((s, v) => s + v, 0)).toBe(1);
    expect(factsToMap(facts, 2030).size).toBe(0);
  });

  it('sums repeated months and keeps revenue and consuntivo apart', () => {
    const m = factsToMap([f('A', 2026, 3, 10, 1), f('A', 2026, 3, 5, 2)], 2026).get('A')!;
    expect(m.rev[2]).toBe(15);
    expect(m.cons[2]).toBe(3);
  });
});

describe('overlayMesi', () => {
  it('stamps the profiles of the year on the interventi, with the derived revenue total', () => {
    const base = [makeIf({ numero_if: 'A' }), makeIf({ numero_if: 'B' })];
    const out = overlayMesi(base, factsToMap([f('A', 2026, 1, 10.5), f('A', 2026, 12, 4.5, 3)], 2026));
    expect(out[0].rev_mesi[0]).toBe(10.5);
    expect(out[0].rev_mesi[11]).toBe(4.5);
    expect(out[0].cons_mesi[11]).toBe(3);
    expect(out[0].revenue_anno).toBe(15);
    expect(out[1].rev_mesi).toEqual(Array(12).fill(0));
    expect(out[1].revenue_anno).toBe(0);
  });

  it('does not mutate its input and hands out independent arrays', () => {
    const base = [makeIf({ numero_if: 'A', rev_mesi: Array(12).fill(7) })];
    const map = factsToMap([f('A', 2026, 1, 1)], 2026);
    const out = overlayMesi(base, map);
    expect(base[0].rev_mesi).toEqual(Array(12).fill(7));
    out[0].rev_mesi[5] = 999;
    expect(map.get('A')!.rev[5]).toBe(0);
    expect(overlayMesi(base, map)[0].rev_mesi[5]).toBe(0);
  });
});

describe('profileFacts', () => {
  it('turns two 12-value profiles into sparse facts', () => {
    expect(profileFacts('A', 2026, [5, 0, 0, 7], [0, 0, 0, 0, 2])).toEqual([
      f('A', 2026, 1, 5, 0),
      f('A', 2026, 4, 7, 0),
      f('A', 2026, 5, 0, 2),
    ]);
  });
  it('produces nothing for empty or all-zero profiles', () => {
    expect(profileFacts('A', 2026, [], [])).toEqual([]);
    expect(profileFacts('A', 2026, Array(12).fill(0), null)).toEqual([]);
  });
});

describe('normalizeFacts — untrusted upload payloads', () => {
  it('keeps well-formed facts and coerces numeric strings', () => {
    expect(normalizeFacts([{ numero_if: ' 20260001 ', anno: '2026', mese: '3', revenue: '10.5', consuntivo: 2 }])).toEqual([f('20260001', 2026, 3, 10.5, 2)]);
    expect(normalizeFacts([{ numero_if: 20260001, anno: 2026, mese: 1, revenue: 1 }])).toEqual([f('20260001', 2026, 1, 1, 0)]);
  });

  it('drops anything that is not a valid fact', () => {
    const bad: unknown[] = [
      null,
      'x',
      42,
      {},
      { numero_if: '', anno: 2026, mese: 1, revenue: 1 },
      { numero_if: 'A', anno: 1999, mese: 1, revenue: 1 },
      { numero_if: 'A', anno: 2026, mese: 0, revenue: 1 },
      { numero_if: 'A', anno: 2026, mese: 13, revenue: 1 },
      { numero_if: 'A', anno: 2026, mese: 1.5, revenue: 1 },
      { numero_if: 'A', anno: 'abc', mese: 1, revenue: 1 },
      { numero_if: { toString: () => 'A' }, anno: 2026, mese: 1, revenue: 1 },
    ];
    expect(normalizeFacts(bad)).toEqual([]);
  });

  it('turns non-finite amounts into 0 rather than dropping the month', () => {
    expect(normalizeFacts([{ numero_if: 'A', anno: 2026, mese: 1, revenue: 'abc', consuntivo: Infinity }])).toEqual([f('A', 2026, 1, 0, 0)]);
  });

  it('returns nothing for a non-array', () => {
    for (const v of [undefined, null, {}, 'x', 5]) expect(normalizeFacts(v)).toEqual([]);
  });
});
