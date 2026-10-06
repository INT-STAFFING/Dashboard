import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from '@/lib/db';
import { DASHBOARD_DATA_TAG, getDashboardData } from '@/lib/getDashboardData';
import { persistMesiFromUpload, pickDefaultAnno } from '@/lib/mesiStore';
import { softDeleteIntervento } from '@/lib/store';
import { SEED_ANNO, SEED_INTERVENTI } from '@/lib/seed';

// unstable_cache is replaced by a pass-through that records how it was used, so the
// payload assembly (and what goes into the cache key) can be tested without Next.
const cache = vi.hoisted(() => ({ keyParts: null as unknown, opts: null as unknown, calls: [] as unknown[][] }));
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown, keyParts: unknown, opts: unknown) => {
    cache.keyParts = keyParts;
    cache.opts = opts;
    return (...args: unknown[]) => {
      cache.calls.push(args);
      return fn(...args);
    };
  },
}));

const CY = new Date().getFullYear();
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__ARIA_MEM__; // back to the baseline portfolio and its months
  delete g.__ARIA_MESI__;
  cache.calls.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('getDashboardData — baseline portfolio', () => {
  it('REGRESSION: shows the seed year with the same portfolio and revenue it always showed', async () => {
    const d = await getDashboardData();
    expect(d.anno).toBe(SEED_ANNO);
    expect(d.anni).toEqual([SEED_ANNO]);
    expect(d.interventi).toHaveLength(SEED_INTERVENTI.length);
    expect(d.kpi.count).toBe(SEED_INTERVENTI.length);

    // Per-partner monthly revenue equals the profiles the seed always carried.
    for (const partner of ['Intellera', 'Deloitte'] as const) {
      const expected = Array.from({ length: 12 }, (_, mi) => sum(SEED_INTERVENTI.filter((i) => i.fornitore === partner).map((i) => i.rev_mesi[mi])));
      const key = partner.toLowerCase() as 'intellera' | 'deloitte';
      d.revenue_mensile.forEach((r, mi) => expect(r[key]).toBeCloseTo(expected[mi], 4));
    }
    expect(d.revenue_mensile[0].mese).toBe(`${SEED_ANNO}-01`);
  });

  it('every intervento carries the profile of the year and a derived revenue total', async () => {
    const d = await getDashboardData();
    for (const i of d.interventi) {
      expect(i.rev_mesi).toHaveLength(12);
      expect(i.cons_mesi).toHaveLength(12);
      expect(i.revenue_anno).toBeCloseTo(sum(i.rev_mesi), 4);
    }
    const seedTotal = sum(SEED_INTERVENTI.map((i) => sum(i.rev_mesi)));
    expect(sum(d.interventi.map((i) => i.revenue_anno))).toBeCloseTo(seedTotal, 2);
  });

  it('the Timeline series is the Intellera one, for the years that have data', async () => {
    const d = await getDashboardData();
    expect(d.timeline_my.years).toEqual([SEED_ANNO]);
    const intelleraRev = sum(SEED_INTERVENTI.filter((i) => i.fornitore === 'Intellera').map((i) => sum(i.rev_mesi)));
    expect(sum(d.timeline_my.months.map((m) => m.revenue))).toBeCloseTo(intelleraRev, 2);
  });
});

describe('getDashboardData — several years', () => {
  const firstIf = SEED_INTERVENTI.find((i) => i.fornitore === 'Intellera')!.numero_if;

  beforeEach(async () => {
    await persistMesiFromUpload([
      { numero_if: firstIf, anno: 2027, mese: 2, revenue: 1000, consuntivo: 400 },
      { numero_if: firstIf, anno: 2025, mese: 12, revenue: 250, consuntivo: 0 },
    ]);
  });

  it('lists every year with data, ascending', async () => {
    expect((await getDashboardData()).anni).toEqual([2025, 2026, 2027]);
  });

  it('the requested year decides which profiles the interventi carry', async () => {
    const d27 = await getDashboardData(2027);
    const i27 = d27.interventi.find((i) => i.numero_if === firstIf)!;
    expect(d27.anno).toBe(2027);
    expect(i27.rev_mesi[1]).toBe(1000);
    expect(i27.cons_mesi[1]).toBe(400);
    expect(i27.revenue_anno).toBe(1000);
    expect(d27.revenue_mensile[1]).toMatchObject({ mese: '2027-02' });

    const d26 = await getDashboardData(2026);
    expect(d26.interventi.find((i) => i.numero_if === firstIf)!.rev_mesi[1]).not.toBe(1000);
  });

  it('REGRESSION: the anagrafica and KPIs do not depend on the year', async () => {
    const [a, b] = [await getDashboardData(2025), await getDashboardData(2027)];
    expect(a.kpi).toEqual(b.kpi);
    expect(a.interventi.map((i) => i.numero_if)).toEqual(b.interventi.map((i) => i.numero_if));
  });

  it('the multi-year Timeline always has every year, whichever one is selected', async () => {
    for (const anno of [2025, 2026, 2027]) {
      const d = await getDashboardData(anno);
      expect(d.timeline_my.years).toEqual([2025, 2026, 2027]);
      expect(d.timeline_my.months).toHaveLength(36);
    }
    const t = (await getDashboardData()).timeline_my;
    expect(t.months.find((m) => m.anno === 2027 && m.mese === 2)).toMatchObject({ revenue: 1000, consuntivato: 400 });
    expect(t.months.find((m) => m.anno === 2025 && m.mese === 12)).toMatchObject({ revenue: 250 });
  });

  it('a year with no data can be asked for: empty profiles, and it is offered in the list', async () => {
    const d = await getDashboardData(2030);
    expect(d.anno).toBe(2030);
    expect(d.anni).toEqual([2025, 2026, 2027, 2030]);
    expect(d.interventi.every((i) => i.revenue_anno === 0 && i.rev_mesi.every((v) => v === 0))).toBe(true);
    expect(d.timeline_my.years).toEqual([2025, 2026, 2027]);
  });

  it.each(['abc', 1800, '2026.5', '', null, undefined, [], {}])('ignores an invalid year (%j) and uses the default', async (bad) => {
    const d = await getDashboardData(bad);
    expect(d.anno).toBe(pickDefaultAnno([2025, 2026, 2027], new Date()));
  });

  it("deleted IFs' months stay out of the Timeline", async () => {
    const before = sum((await getDashboardData(2027)).timeline_my.months.map((m) => m.revenue));
    await softDeleteIntervento(firstIf);
    const after = sum((await getDashboardData(2027)).timeline_my.months.map((m) => m.revenue));
    expect(after).toBeLessThan(before);
    expect((await getDashboardData(2027)).timeline_my.months.find((m) => m.anno === 2027 && m.mese === 2)?.revenue ?? 0).toBe(0);
  });
});

describe('getDashboardData — the cache', () => {
  it('is keyed by the year asked for (or null) and the current year, so the default rolls over by itself', async () => {
    await getDashboardData();
    await getDashboardData(2027);
    await getDashboardData('2026');
    await getDashboardData('rubbish');
    expect(cache.calls).toEqual([
      [null, CY],
      [2027, CY],
      [2026, CY],
      [null, CY],
    ]);
  });

  it('is tagged for invalidation and versioned with the schema', () => {
    expect(cache.opts).toEqual({ tags: [DASHBOARD_DATA_TAG] });
    expect(cache.keyParts).toEqual(['dashboard-data', `schema-v${SCHEMA_VERSION}`]);
  });

  it('logs how long a rebuild took, with the year and the payload size', async () => {
    await getDashboardData(2026);
    const line = vi.mocked(console.log).mock.calls.map((c) => String(c[1] ?? '')).find((l) => l.includes('dashboard_data'));
    expect(line).toBeTruthy();
    expect(JSON.parse(line!)).toMatchObject({ evt: 'dashboard_data', ok: true, anno: 2026, interventi: SEED_INTERVENTI.length });
  });
});
