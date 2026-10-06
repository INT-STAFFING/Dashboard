import { describe, expect, it } from 'vitest';
import {
  FISCAL_ORDER,
  aggregate,
  annual,
  availableYears,
  monthly,
  quarterly,
  sumSeries,
  todayIndex,
  yearSeriesMonthly,
  yearSeriesMonthlyMap,
  yearSeriesQuarterly,
  yearSeriesQuarterlyMap,
  yearTotal,
} from '@/lib/fiscal';
import type { TimelineMonth } from '@/lib/types';

const SEQ = Array.from({ length: 12 }, (_, i) => i + 1); // Gen=1 … Dic=12
const tm = (anno: number, mese: number, revenue: number, consuntivato = 0): TimelineMonth => ({ anno, mese, revenue, consuntivato });

describe('monthly / quarterly / annual', () => {
  it('calendar year: Gen..Dic in order', () => {
    const m = monthly(SEQ, 'solare');
    expect(m.map((b) => b.label)).toEqual(['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']);
    expect(m.map((b) => b.value)).toEqual(SEQ);
  });

  it('fiscal year: Set..Ago', () => {
    const m = monthly(SEQ, 'fiscale');
    expect(m.map((b) => b.label)).toEqual(['Set', 'Ott', 'Nov', 'Dic', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago']);
    expect(m.map((b) => b.value)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(FISCAL_ORDER).toEqual([8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('quarters: calendar Q1..Q4 and fiscal Set–Nov / Dic–Feb / Mar–Mag / Giu–Ago', () => {
    expect(quarterly(SEQ, 'solare')).toEqual([
      { label: 'Q1', value: 6 },
      { label: 'Q2', value: 15 },
      { label: 'Q3', value: 24 },
      { label: 'Q4', value: 33 },
    ]);
    expect(quarterly(SEQ, 'fiscale').map((b) => b.value)).toEqual([30, 15, 12, 21]);
  });

  it('every view of the same data adds up to the same annual total', () => {
    const total = annual(SEQ);
    expect(total).toBe(78);
    for (const cal of ['solare', 'fiscale'] as const) {
      expect(quarterly(SEQ, cal).reduce((s, b) => s + b.value, 0)).toBe(total);
      expect(monthly(SEQ, cal).reduce((s, b) => s + b.value, 0)).toBe(total);
    }
  });

  it('sanitises missing, short and non-numeric input to zeros', () => {
    expect(monthly(null, 'solare').every((b) => b.value === 0)).toBe(true);
    expect(monthly(undefined, 'fiscale')).toHaveLength(12);
    expect(annual([1, 2, 3])).toBe(6);
    expect(annual(['5', 'x', NaN, null] as unknown as number[])).toBe(5);
  });

  it('aggregate() dispatches on the grain', () => {
    expect(aggregate(SEQ, 'solare', 'mensile')).toHaveLength(12);
    expect(aggregate(SEQ, 'solare', 'trimestrale')).toHaveLength(4);
    expect(aggregate(SEQ, 'solare', 'annuale')).toEqual([{ label: 'Anno solare', value: 78 }]);
    expect(aggregate(SEQ, 'fiscale', 'annuale')).toEqual([{ label: 'Anno fiscale', value: 78 }]);
  });
});

describe('multi-year series', () => {
  const months = [tm(2025, 9, 50, 5), tm(2025, 12, 20), tm(2026, 1, 70, 7), tm(2026, 8, 3)];

  it('calendar year reads only that year', () => {
    const s = yearSeriesMonthly(months, 2026, 'solare', 'revenue');
    expect(s[0]).toEqual({ label: 'Gen', value: 70 });
    expect(s[7]).toEqual({ label: 'Ago', value: 3 });
    expect(s.reduce((a, b) => a + b.value, 0)).toBe(73);
  });

  it('fiscal year Y spans Set Y .. Ago Y+1, reading two calendar years', () => {
    const s = yearSeriesMonthly(months, 2025, 'fiscale', 'revenue');
    expect(s.map((b) => b.label)[0]).toBe('Set');
    expect(s[0].value).toBe(50); // Set 2025
    expect(s[3].value).toBe(20); // Dic 2025
    expect(s[4].value).toBe(70); // Gen 2026
    expect(s[11].value).toBe(3); // Ago 2026
    expect(yearTotal(months, 2025, 'fiscale', 'revenue')).toBe(143);
    expect(yearTotal(months, 2026, 'fiscale', 'revenue')).toBe(0);
  });

  it('reads the chosen metric', () => {
    expect(yearTotal(months, 2025, 'fiscale', 'consuntivato')).toBe(12);
  });

  it('quarterly series is the monthly one summed by three', () => {
    expect(yearSeriesQuarterly(months, 2025, 'fiscale', 'revenue').map((b) => b.value)).toEqual([50, 20 + 70, 0, 3]);
  });

  it('map-based variants give the same buckets (used for BEF totals)', () => {
    const vm = new Map<string, number>([['2025-9', 50], ['2026-1', 70]]);
    expect(yearSeriesMonthlyMap(vm, 2025, 'fiscale')[4].value).toBe(70);
    expect(yearSeriesQuarterlyMap(vm, 2025, 'fiscale').map((b) => b.value)).toEqual([50, 70, 0, 0]);
  });

  it('availableYears: calendar years with data; fiscal years whose window contains data', () => {
    const data = [tm(2025, 1, 1), tm(2026, 1, 1)];
    expect(availableYears(data, 'solare')).toEqual([2025, 2026]);
    expect(availableYears(data, 'fiscale')).toEqual([2024, 2025, 2026]);
    expect(availableYears([], 'fiscale')).toEqual([]);
  });
});

describe('todayIndex', () => {
  const at = (y: number, m: number) => new Date(y, m - 1, 15);

  it('calendar: month index inside the year, 11 once past it, -1 before it', () => {
    expect(todayIndex(2026, 'solare', at(2026, 6))).toBe(5);
    expect(todayIndex(2026, 'solare', at(2027, 1))).toBe(11);
    expect(todayIndex(2026, 'solare', at(2025, 12))).toBe(-1);
  });

  it('fiscal: Set is 0, Gen of the next year is 4, Ago is 11; 11 once past, -1 before', () => {
    expect(todayIndex(2025, 'fiscale', at(2025, 9))).toBe(0);
    expect(todayIndex(2025, 'fiscale', at(2025, 10))).toBe(1);
    expect(todayIndex(2025, 'fiscale', at(2026, 1))).toBe(4);
    expect(todayIndex(2025, 'fiscale', at(2026, 8))).toBe(11);
    expect(todayIndex(2025, 'fiscale', at(2026, 9))).toBe(11);
    expect(todayIndex(2025, 'fiscale', at(2025, 8))).toBe(-1);
  });
});

describe('sumSeries', () => {
  it('adds series element-wise and tolerates null/short ones', () => {
    expect(sumSeries([SEQ, SEQ, null, [1]])).toEqual(SEQ.map((n, i) => n * 2 + (i === 0 ? 1 : 0)));
    expect(sumSeries([])).toEqual(Array(12).fill(0));
  });
});
