// Aggregation helpers for revenue / consuntivazione monthly series.
//
// Input is always a 12-length array in CALENDAR order (index 0 = Gennaio …
// index 11 = Dicembre), matching `rev_mesi` / `cons_mesi`.
//
// We expose both calendar-year ("anno solare", Gen–Dic) and fiscal-year
// ("anno fiscale", Set–Ago) views, each at monthly / quarterly / annual grain.

import { MESI } from './format';

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

// Element-wise sum of several 12-length arrays.
export function sumSeries(series: (number[] | null | undefined)[]): number[] {
  const out = Array(12).fill(0) as number[];
  for (const s of series) {
    const a = v12(s);
    for (let i = 0; i < 12; i++) out[i] += a[i];
  }
  return out;
}
