import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/upload/route';
import { getIfMesi, listFacts } from '@/lib/mesiStore';
import { createIntervento, getIntervento, listInterventiBase } from '@/lib/store';

const state = vi.hoisted(() => ({ user: null as null | { id: number; email: string; role: string; status: string } }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSessionUser: async () => state.user };
});
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const EDITOR = { id: 3, email: 'plus@x.it', role: 'USERPLUS', status: 'approved' };
const VIEWER = { id: 4, email: 'viewer@x.it', role: 'USER', status: 'approved' };

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.UPLOAD_SECRET;
  state.user = EDITOR;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.UPLOAD_SECRET;
  else process.env.UPLOAD_SECRET = savedSecret;
});

const upload = (query = '', headers: Record<string, string> = {}) =>
  POST(
    new Request(`http://localhost/api/upload${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ kind: 'dashboard', interventi: [] }),
    }),
  );

describe('POST /api/upload — secret handling', () => {
  it('REGRESSION: viewers cannot upload (403)', async () => {
    state.user = VIEWER;
    delete process.env.UPLOAD_SECRET;
    expect((await upload()).status).toBe(403);
  });

  it('REGRESSION: with no UPLOAD_SECRET configured an editor passes the gate', async () => {
    delete process.env.UPLOAD_SECRET;
    const res = await upload();
    expect([401, 403]).not.toContain(res.status);
  });

  it('accepts the secret in the x-upload-secret header', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    const res = await upload('', { 'x-upload-secret': 's3cret' });
    expect([401, 403]).not.toContain(res.status);
  });

  it('rejects a wrong or missing secret with 401', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    expect((await upload('', { 'x-upload-secret': 'wrong' })).status).toBe(401);
    expect((await upload()).status).toBe(401);
  });

  it('no longer accepts the secret as ?token= in the query string', async () => {
    process.env.UPLOAD_SECRET = 's3cret';
    expect((await upload('?token=s3cret')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Monthly revenue travels as per-year facts
// ---------------------------------------------------------------------------
describe('POST /api/upload — monthly facts', () => {
  const m = (...v: number[]): number[] => [...v, ...Array(12 - v.length).fill(0)];
  const iff = (numero_if: string, over: Record<string, unknown> = {}) => ({ numero_if, titolo: `IF ${numero_if}`, fornitore: 'Intellera', importo: 10, ...over });
  const fact = (numero_if: string, anno: number, mese: number, revenue: number, consuntivo = 0) => ({ numero_if, anno, mese, revenue, consuntivo });
  const send = (body: unknown, query = '') =>
    POST(new Request(`http://localhost/api/upload${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  beforeEach(() => {
    delete process.env.UPLOAD_SECRET;
    state.user = EDITOR;
    const g = globalThis as Record<string, unknown>;
    g.__ARIA_MEM__ = [];
    g.__ARIA_MESI__ = new Map();
  });

  it('stores the facts of every year the workbook carried, for the IFs it wrote', async () => {
    const res = await send({ kind: 'dashboard', interventi: [iff('A'), iff('B')], mesi: [fact('A', 2025, 12, 5), fact('A', 2026, 1, 100), fact('B', 2027, 3, 7)] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, inserted: 2, mesi_saved: 3 });
    expect((await getIfMesi('A', 2025)).rev).toEqual([...Array(11).fill(0), 5]);
    expect((await getIfMesi('A', 2026)).rev).toEqual(m(100));
    expect((await getIfMesi('B', 2027)).rev).toEqual(m(0, 0, 7));
  });

  it('REGRESSION: re-uploading a file that carries no revenue (IF_ARIA) keeps what is stored', async () => {
    await send({ kind: 'dashboard', interventi: [iff('A')], mesi: [fact('A', 2026, 1, 100), fact('A', 2026, 2, 50)] });
    await send({ kind: 'if', interventi: [iff('A', { ambito: 'Sviluppo' })] });
    expect(await getIntervento('A', 2026)).toMatchObject({ ambito: 'Sviluppo', rev_mesi: m(100, 50), revenue_anno: 150 });
  });

  it('REGRESSION: manually edited IFs keep their months too (skipped unless force)', async () => {
    await createIntervento({ numero_if: 'M', titolo: 'Mia', rev_mesi: m(1), anno: 2026 });
    const res = await send({ kind: 'dashboard', interventi: [iff('M'), iff('N')], mesi: [fact('M', 2026, 1, 999), fact('N', 2026, 1, 5)] });
    const body = await res.json();
    expect(body).toMatchObject({ skipped: 1, inserted: 1, mesi_saved: 1 });
    expect((await getIfMesi('M', 2026)).rev).toEqual(m(1));
    expect((await getIfMesi('N', 2026)).rev).toEqual(m(5));
    // With force the file wins, months included.
    await send({ kind: 'dashboard', interventi: [iff('M')], mesi: [fact('M', 2026, 1, 999)] }, '?force=true');
    expect((await getIfMesi('M', 2026)).rev).toEqual(m(999));
  });

  it('never stores facts for IFs the upload did not write', async () => {
    await send({ kind: 'dashboard', interventi: [iff('A')], mesi: [fact('A', 2026, 1, 1), fact('GHOST', 2026, 1, 99)] });
    expect((await listFacts()).map((f) => f.numero_if)).toEqual(['A']);
    expect((await listInterventiBase()).map((i) => i.numero_if)).toEqual(['A']);
  });

  it('drops malformed facts and keeps the good ones', async () => {
    const res = await send({
      kind: 'dashboard',
      interventi: [iff('A')],
      mesi: [fact('A', 1999, 1, 1), fact('A', 2026, 13, 1), { numero_if: 'A' }, 'x', null, fact('A', 2026, 4, 8)],
    });
    expect((await res.json()).mesi_saved).toBe(1);
    expect((await getIfMesi('A', 2026)).rev).toEqual(m(0, 0, 0, 8));
  });

  it('a payload without facts at all stores no months (and `mesi: []` is not the legacy shape)', async () => {
    await send({ kind: 'if', interventi: [iff('A')], mesi: [] });
    expect(await listFacts()).toEqual([]);
  });

  describe('a client from before the change (a tab left open across a deploy)', () => {
    it('still gets its 12-value profiles stored, under ?anno / body.anno', async () => {
      const res = await send({ kind: 'dashboard', interventi: [iff('A', { rev_mesi: m(10, 20), cons_mesi: m(0, 0, 3) })], anno: 2024 });
      expect((await res.json()).mesi_saved).toBe(3);
      expect(await getIfMesi('A', 2024)).toEqual({ rev: m(10, 20), cons: m(0, 0, 3) });
    });

    it('defaults to the portfolio\'s default year when the body names none', async () => {
      await send({ kind: 'dashboard', interventi: [iff('A', { rev_mesi: m(4) })] });
      const facts = await listFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ numero_if: 'A', mese: 1, revenue: 4 });
      expect(facts[0].anno).toBe(new Date().getFullYear());
    });

    it('ignores the old revenue_2026 field: the total is derived from the months', async () => {
      await send({ kind: 'dashboard', interventi: [iff('A', { revenue_2026: 12345, rev_mesi: m(1, 2) })], anno: 2026 });
      expect(await getIntervento('A', 2026)).toMatchObject({ revenue_anno: 3 });
    });
  });

  it('the new payload takes precedence: legacy profiles on the interventi are not read when `mesi` is present', async () => {
    await send({ kind: 'dashboard', interventi: [iff('A', { rev_mesi: m(999) })], mesi: [fact('A', 2026, 2, 5)] });
    expect((await getIfMesi('A', 2026)).rev).toEqual(m(0, 5));
  });

  it('REGRESSION: viewers still cannot upload, and a wrong secret is still refused', async () => {
    state.user = VIEWER;
    expect((await send({ kind: 'dashboard', interventi: [iff('A')] })).status).toBe(403);
    state.user = EDITOR;
    process.env.UPLOAD_SECRET = 's3cret';
    expect((await send({ kind: 'dashboard', interventi: [iff('A')] })).status).toBe(401);
  });

  it('rejects an unrecognised file kind', async () => {
    expect((await send({ kind: 'unknown', interventi: [] })).status).toBe(422);
  });
});
