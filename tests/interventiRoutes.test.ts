import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listRoute, POST as createRoute } from '@/app/api/interventi/route';
import { DELETE as deleteRoute, GET as getRoute, PUT as updateRoute } from '@/app/api/interventi/[num_if]/route';
import { GET as dataRoute } from '@/app/api/data/route';
import { revalidateTag } from 'next/cache';
import { DASHBOARD_DATA_TAG } from '@/lib/getDashboardData';
import { setIfYear } from '@/lib/mesiStore';

const auth = vi.hoisted(() => ({ user: null as null | { id: number; email: string; role: string; status: string } }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSessionUser: async () => auth.user };
});
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const EDITOR = { id: 1, email: 'plus@x.it', role: 'USERPLUS', status: 'approved' };
const VIEWER = { id: 2, email: 'viewer@x.it', role: 'USER', status: 'approved' };
const m = (...v: number[]): number[] => [...v, ...Array(12 - v.length).fill(0)];

const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: { num_if: id } });

beforeEach(() => {
  auth.user = EDITOR;
  const g = globalThis as Record<string, unknown>;
  g.__ARIA_MEM__ = [];
  g.__ARIA_MESI__ = new Map();
  vi.mocked(revalidateTag).mockClear();
});

describe('POST /api/interventi', () => {
  it('creates an IF with the monthly profiles of the given year', async () => {
    const res = await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', rev_mesi: m(10, 20), cons_mesi: m(0, 5), anno: 2025 })));
    expect(res.status).toBe(201);
    const { created } = await res.json();
    expect(created).toMatchObject({ numero_if: 'A', rev_mesi: m(10, 20), cons_mesi: m(0, 5), revenue_anno: 30 });
    expect(created).not.toHaveProperty('anno');
    expect(revalidateTag).toHaveBeenCalledWith(DASHBOARD_DATA_TAG);
    // …and they are filed under 2025, not under any other year.
    const y25 = await (await getRoute(req('/api/interventi/A?anno=2025'), params('A'))).json();
    const y26 = await (await getRoute(req('/api/interventi/A?anno=2026'), params('A'))).json();
    expect(y25.intervento.rev_mesi).toEqual(m(10, 20));
    expect(y26.intervento.rev_mesi).toEqual(m());
  });

  it('REGRESSION: viewers cannot create, bad bodies are rejected, duplicates are 409', async () => {
    auth.user = VIEWER;
    expect((await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'x' })))).status).toBe(403);
    auth.user = EDITOR;
    expect((await createRoute(req('/api/interventi', { method: 'POST', body: 'not json' }))).status).toBe(400);
    expect((await createRoute(req('/api/interventi', json({ titolo: 'senza numero' })))).status).toBe(400);
    expect((await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'x' })))).status).toBe(201);
    expect((await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'x' })))).status).toBe(409);
  });
});

describe('PUT /api/interventi/[num_if]', () => {
  const seed = async () => {
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', rev_mesi: m(10), anno: 2026 })));
    vi.mocked(revalidateTag).mockClear();
  };
  const put = (id: string, body: unknown) => updateRoute(req(`/api/interventi/${id}`, { ...json(body), method: 'PUT' }), params(id));

  it('updates the months of the year it is told, and answers with that year', async () => {
    await seed();
    const res = await put('A', { rev_mesi: m(1, 2, 3), anno: 2027 });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toMatchObject({ rev_mesi: m(1, 2, 3), revenue_anno: 6 });
    expect(revalidateTag).toHaveBeenCalledWith(DASHBOARD_DATA_TAG);
    const other = await (await getRoute(req('/api/interventi/A?anno=2026'), params('A'))).json();
    expect(other.intervento.rev_mesi).toEqual(m(10)); // untouched
  });

  it('REGRESSION: a field edit from the dashboard keeps the months and shows the year on screen', async () => {
    await seed();
    const res = await put('A', { titolo: 'Rinominato', anno: 2026 });
    expect((await res.json()).updated).toMatchObject({ titolo: 'Rinominato', rev_mesi: m(10), revenue_anno: 10 });
  });

  it('REGRESSION: 403 for viewers, 404 for unknown IFs, 400 for invalid values — and no cache invalidation', async () => {
    await seed();
    auth.user = VIEWER;
    expect((await put('A', { titolo: 'x' })).status).toBe(403);
    auth.user = EDITOR;
    expect((await put('nope', { titolo: 'x' })).status).toBe(404);
    expect((await put('A', { importo: -1 })).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('GET /api/interventi', () => {
  it('needs a logged-in viewer', async () => {
    auth.user = null;
    expect((await listRoute(req('/api/interventi'))).status).toBe(403);
    expect((await getRoute(req('/api/interventi/A'), params('A'))).status).toBe(403);
  });

  it('lists the portfolio with the profiles of ?anno=, the default year otherwise', async () => {
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno' })));
    await setIfYear('A', 2025, m(4), m());
    await setIfYear('A', 2031, m(9), m());
    const of = async (qs: string) => (await (await listRoute(req(`/api/interventi${qs}`))).json()).interventi[0].revenue_anno;
    expect(await of('?anno=2025')).toBe(4);
    expect(await of('?anno=2031')).toBe(9);
    expect(await of('?anno=2040')).toBe(0);
    // Not a valid year -> the default (the closest year with data to today), never an error.
    const fallback = await of('?anno=abc');
    expect([4, 9]).toContain(fallback);
    expect(await of('')).toBe(fallback);
  });

  it('GET one IF: 404 when missing, the year asked for otherwise', async () => {
    expect((await getRoute(req('/api/interventi/nope'), params('nope'))).status).toBe(404);
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', rev_mesi: m(2), anno: 2024 })));
    expect((await (await getRoute(req('/api/interventi/A?anno=2024'), params('A'))).json()).intervento.revenue_anno).toBe(2);
  });
});

describe('DELETE /api/interventi/[num_if]', () => {
  it('soft-deletes, invalidates the cache, and the months stay stored', async () => {
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', rev_mesi: m(3), anno: 2026 })));
    vi.mocked(revalidateTag).mockClear();
    auth.user = VIEWER;
    expect((await deleteRoute(req('/api/interventi/A', { method: 'DELETE' }), params('A'))).status).toBe(403);
    auth.user = EDITOR;
    expect((await deleteRoute(req('/api/interventi/A', { method: 'DELETE' }), params('A'))).status).toBe(200);
    expect((await deleteRoute(req('/api/interventi/A', { method: 'DELETE' }), params('A'))).status).toBe(404);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect((await (await listRoute(req('/api/interventi?anno=2026'))).json()).interventi).toEqual([]);
  });
});

describe('GET /api/data', () => {
  it('needs a viewer and reports the year its monthly profiles refer to', async () => {
    auth.user = null;
    expect((await dataRoute(req('/api/data'))).status).toBe(403);
    auth.user = EDITOR;
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', fornitore: 'Intellera', rev_mesi: m(100), anno: 2024 })));
    auth.user = VIEWER;
    const body = await (await dataRoute(req('/api/data?anno=2024'))).json();
    expect(body.anno).toBe(2024);
    expect(body.revenue_mensile[0]).toMatchObject({ mese: '2024-01', intellera: 100 });
    expect(body.interventi[0].revenue_anno).toBe(100);
  });

  it('filters change the KPIs but not the year', async () => {
    auth.user = EDITOR;
    await createRoute(req('/api/interventi', json({ numero_if: 'A', titolo: 'Uno', fornitore: 'Intellera', importo: 10 })));
    await createRoute(req('/api/interventi', json({ numero_if: 'B', titolo: 'Due', fornitore: 'Deloitte', importo: 5 })));
    const body = await (await dataRoute(req('/api/data?anno=2026&fornitore=Deloitte'))).json();
    expect(body.anno).toBe(2026);
    expect(body.view_count).toBe(1);
    expect(body.kpi.totale).toBe(5);
    expect(body.interventi).toHaveLength(2);
  });
});
