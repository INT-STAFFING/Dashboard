// Aggregation helpers for revenue / consuntivazione monthly series.
//
// Input is always a 12-length array in CALENDAR order (index 0 = Gennaio …
// index 11 = Dicembre), matching `rev_mesi` / `cons_mesi`.
//
// We expose both calendar-year ("anno solare", Gen–Dic) and fiscal-year
// ("anno fiscale", Set–Ago) views, each at monthly / quarterly / annual grain.

import { MESI } from './format';
import type { TimelineMonth } from './types';

export const MONTHS_SOLARE = MESI; // Gen..Dic

// Fiscal year starts in September: Set, Ott, Nov, Dic, Gen … Ago.
export const FISCAL_ORDER = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];
export const MONTHS_FISCALE = FISCAL_ORDER.map((i) => MESI[i]);

export type Calendar = 'solare' | 'fiscale';
export type Grain = 'mensile' | 'trimestrale' | 'annuale';

const v12 = (a: number[] | null | undefined): number[] => {
  const out = Array(12).fill(0) as number[];
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) out[i] = Number(a[i]) || 0;
  return out;
};

export type Bucket = { label: string; value: number };

// Monthly buckets in the chosen calendar order.
export function monthly(arr: number[] | null | undefined, cal: Calendar): Bucket[] {
  const a = v12(arr);
  const order = cal === 'fiscale' ? FISCAL_ORDER : MESI.map((_, i) => i);
  return order.map((mi) => ({ label: MESI[mi], value: a[mi] }));
}

// Quarter definitions as calendar-month indexes.
const Q_SOLARE: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11],
];
const Q_FISCALE: number[][] = [
  [8, 9, 10], // Set–Nov
  [11, 0, 1], // Dic–Feb
  [2, 3, 4], // Mar–Mag
  [5, 6, 7], // Giu–Ago
];

export function quarterly(arr: number[] | null | undefined, cal: Calendar): Bucket[] {
  const a = v12(arr);
  const qs = cal === 'fiscale' ? Q_FISCALE : Q_SOLARE;
  return qs.map((q, i) => ({
    label: `Q${i + 1}`,
    value: q.reduce((s, mi) => s + a[mi], 0),
  }));
}

export function annual(arr: number[] | null | undefined): number {
  return v12(arr).reduce((s, n) => s + n, 0);
}

export function aggregate(
  arr: number[] | null | undefined,
  cal: Calendar,
  grain: Grain,
): Bucket[] {
  if (grain === 'mensile') return monthly(arr, cal);
  if (grain === 'trimestrale') return quarterly(arr, cal);
  return [{ label: cal === 'fiscale' ? 'Anno fiscale' : 'Anno solare', value: annual(arr) }];
}

// ---------------------------------------------------------------------------
// Multi-year aggregation (F-2)
// ---------------------------------------------------------------------------
// Built on TimelineMonth facts (calendar anno + mese). A fiscal year `Y` spans
// Set Y .. Ago Y+1 and therefore reads from two calendar years.

export type Metric = 'revenue' | 'consuntivato';

// Calendar month numbers (1..12) in fiscal display order: Set..Ago.
const FISCAL_MONTH_NUMS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

function valueMap(months: TimelineMonth[], metric: Metric): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of months) {
    m.set(`${r.anno}-${r.mese}`, metric === 'revenue' ? r.revenue : r.consuntivato);
  }
  return m;
}

// 12 monthly buckets for a year window, in display order for the calendar.
//  - solare:  Gen..Dic of `year`
//  - fiscale: Set `year` .. Ago `year+1`
export function yearSeriesMonthly(
  months: TimelineMonth[],
  year: number,
  cal: Calendar,
  metric: Metric,
): Bucket[] {
  const vm = valueMap(months, metric);
  if (cal === 'solare') {
    return MESI.map((label, i) => ({ label, value: vm.get(`${year}-${i + 1}`) ?? 0 }));
  }
  return FISCAL_MONTH_NUMS.map((mNum, idx) => {
    const y = idx < 4 ? year : year + 1; // Set..Dic = year, Gen..Ago = year+1
    return { label: MESI[mNum - 1], value: vm.get(`${y}-${mNum}`) ?? 0 };
  });
}

export function yearSeriesQuarterly(
  months: TimelineMonth[],
  year: number,
  cal: Calendar,
  metric: Metric,
): Bucket[] {
  const m = yearSeriesMonthly(months, year, cal, metric);
  return [0, 1, 2, 3].map((q) => ({
    label: `Q${q + 1}`,
    value: m.slice(q * 3, q * 3 + 3).reduce((s, b) => s + b.value, 0),
  }));
}

export function yearTotal(
  months: TimelineMonth[],
  year: number,
  cal: Calendar,
  metric: Metric,
): number {
  return yearSeriesMonthly(months, year, cal, metric).reduce((s, b) => s + b.value, 0);
}

// Years selectable for a calendar.
//  - solare:  calendar years that have data
//  - fiscale: fiscal year `Y` (Set Y .. Ago Y+1) is offered when Y or Y+1 has data
export function availableYears(months: TimelineMonth[], cal: Calendar): number[] {
  const years = new Set(months.map((m) => m.anno));
  if (cal === 'solare') return [...years].sort((a, b) => a - b);
  const fy = new Set<number>();
  for (const y of years) {
    if (years.has(y) || years.has(y - 1)) fy.add(y); // Y window reads Y and Y+1 -> offer Y and Y-1
    fy.add(y - 1);
  }
  return [...fy].filter((y) => years.has(y) || years.has(y + 1)).sort((a, b) => a - b);
}

// Index (0..11) of the current month within a year window, for the "today"
// chart marker. Returns -1 if the window is entirely in the future, 11 if past.
export function todayIndex(year: number, cal: Calendar, now: Date = new Date()): number {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  const nowVal = cy * 12 + (cm - 1);
  if (cal === 'solare') {
    if (cy === year) return cm - 1;
    return cy > year ? 11 : -1;
  }
  for (let idx = 0; idx < 12; idx++) {
    const y = idx < 4 ? year : year + 1;
    if (y === cy && FISCAL_MONTH_NUMS[idx] === cm) return idx;
  }
  const startVal = year * 12 + 8; // Set `year` (month index 8)
  const endVal = (year + 1) * 12 + 7; // Ago `year+1` (month index 7)
  return nowVal > endVal ? 11 : nowVal < startVal ? -1 : -1;
}

// Element-wise sum of several 12-length arrays.
export function sumSeries(series: (number[] | null | undefined)[]): number[] {
  const out = Array(12).fill(0) as number[];
  for (const s of series) {
    const a = v12(s);
    for (let i = 0; i < 12; i++) out[i] += a[i];
  }
  return out;
}
