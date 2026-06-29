import { eq } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { timeline_mensile } from './schema';
import { getTimeline } from './portfolio';
import type { TimelineMonth, MultiYearTimeline } from './types';

// Multi-year revenue/consuntivazione store (portfolio-level), DB-backed with an
// in-memory fallback. One logical record per calendar (anno, mese). See
// lib/fiscal.ts for solar/fiscal aggregation built on top of these facts.

const v12 = (a: unknown): number[] => {
  const out = Array(12).fill(0) as number[];
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) out[i] = Number(a[i]) || 0;
  return out;
};

type YearArrays = { rev: number[]; cons: number[] };
const g = globalThis as unknown as { __ARIA_TL_MY__?: Record<number, YearArrays> };
function mem(): Record<number, YearArrays> {
  if (!g.__ARIA_TL_MY__) g.__ARIA_TL_MY__ = {};
  return g.__ARIA_TL_MY__;
}

function toMonths(anno: number, rev: number[], cons: number[]): TimelineMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({
    anno,
    mese: i + 1,
    revenue: rev[i] || 0,
    consuntivato: cons[i] || 0,
  }));
}

// Replace the full 12-month set for one calendar year (idempotent save).
export async function setTimelineYear(
  anno: number,
  rev: number[],
  cons: number[],
): Promise<void> {
  const r = v12(rev);
  const c = v12(cons);
  if (hasDB) {
    await ensureSchema();
    await getDb().delete(timeline_mensile).where(eq(timeline_mensile.anno, anno));
    await getDb()
      .insert(timeline_mensile)
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          anno,
          mese: i + 1,
          revenue: String(r[i] || 0),
          consuntivato: String(c[i] || 0),
        })),
      );
    return;
  }
  mem()[anno] = { rev: r, cons: c };
}

// On first access, seed the multi-year store from the legacy single-year
// `timeline` app_config so existing data keeps showing after the migration.
let seeding: Promise<void> | null = null;
async function seedFromLegacyOnce(): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      const tl = await getTimeline();
      const anno = tl.anno || new Date().getFullYear();
      await setTimelineYear(anno, v12(tl.revenue_2026), v12(tl.consuntivazione_2026));
    })().catch((e) => {
      seeding = null;
      throw e;
    });
  }
  return seeding;
}

export async function listTimelineMonths(): Promise<TimelineMonth[]> {
  if (hasDB) {
    await ensureSchema();
    let rows = await getDb().select().from(timeline_mensile);
    if (rows.length === 0) {
      await seedFromLegacyOnce();
      rows = await getDb().select().from(timeline_mensile);
    }
    return rows.map((r) => ({
      anno: r.anno,
      mese: r.mese,
      revenue: r.revenue == null ? 0 : Number(r.revenue),
      consuntivato: r.consuntivato == null ? 0 : Number(r.consuntivato),
    }));
  }
  if (Object.keys(mem()).length === 0) await seedFromLegacyOnce();
  return Object.entries(mem()).flatMap(([anno, y]) => toMonths(Number(anno), y.rev, y.cons));
}

export async function getMultiYearTimeline(): Promise<MultiYearTimeline> {
  const months = await listTimelineMonths();
  const years = [...new Set(months.map((m) => m.anno))].sort((a, b) => a - b);
  return { months, years };
}
