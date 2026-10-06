import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applySchema } from '@/lib/db';
import {
  getIfMesi,
  listAnni,
  listFacts,
  listMesiByAnno,
  persistMesiFromUpload,
  resolveAnno,
  setIfYear,
} from '@/lib/mesiStore';
import {
  createIntervento,
  getIntervento,
  listInterventi,
  listInterventiBase,
  softDeleteIntervento,
  updateIntervento,
  upsertInterventiFromUpload,
} from '@/lib/store';
import { SEED_INTERVENTI, SEED_MESI } from '@/lib/seed';
import type { MonthFact } from '@/lib/types';
import { createTestDb } from './helpers/pglite';
import { makeIf } from './helpers/fixtures';

// The very same scenarios run against the in-memory store and against a real
// Postgres (PGlite) whose schema is built by the production bootstrap
// (applySchema) — so the two backends can't drift apart.
const state = vi.hoisted(() => ({ hasDB: false, db: null as unknown }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});

const CY = new Date().getFullYear();
const m = (...v: number[]): number[] => [...v, ...Array(12 - v.length).fill(0)];
const z = m();
const f = (numero_if: string, anno: number, mese: number, revenue: number, consuntivo = 0): MonthFact => ({ numero_if, anno, mese, revenue, consuntivo });

let pg: PGlite;
let seeded = { interventi: 0, mesi: 0 };

describe.each(['memory', 'database'] as const)('%s backend', (backend) => {
  const isDb = backend === 'database';
  const rowCount = async () => (isDb ? (await pg.query<{ n: number }>('select count(*)::int as n from intervento_mesi')).rows[0].n : (await listFacts()).length);

  beforeAll(async () => {
    if (!isDb) return;
    const t = await createTestDb();
    pg = t.pg;
    state.db = t.db;
    state.hasDB = true;
    await applySchema(t.db as never);
    // First access to a brand-new database seeds the baseline portfolio.
    await listInterventiBase();
    seeded = {
      interventi: (await pg.query<{ n: number }>('select count(*)::int as n from interventi')).rows[0].n,
      mesi: (await pg.query<{ n: number }>('select count(*)::int as n from intervento_mesi')).rows[0].n,
    };
  });
  afterAll(async () => {
    if (isDb) await pg.close();
  });
  beforeEach(async () => {
    state.hasDB = isDb;
    if (isDb) {
      await pg.exec('TRUNCATE interventi, intervento_mesi RESTART IDENTITY');
    } else {
      const g = globalThis as Record<string, unknown>;
      g.__ARIA_MEM__ = [];
      g.__ARIA_MESI__ = new Map();
    }
  });

  if (isDb) {
    it('seeds the baseline portfolio AND its monthly facts into a brand-new database', () => {
      expect(seeded.interventi).toBe(SEED_INTERVENTI.length);
      expect(seeded.mesi).toBe(SEED_MESI.length);
      expect(seeded.mesi).toBeGreaterThan(0);
    });
  }

  describe('creating and reading an IF', () => {
    it('stores the profiles under the year given and reads them back per year', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(10, 20), cons_mesi: m(0, 5), anno: 2025 });
      expect(await getIntervento('A', 2025)).toMatchObject({ rev_mesi: m(10, 20), cons_mesi: m(0, 5), revenue_anno: 30 });
      const other = await getIntervento('A', 2026);
      expect(other).toMatchObject({ rev_mesi: z, cons_mesi: z, revenue_anno: 0 });
      expect((await listInterventi(2025))[0]).toMatchObject({ numero_if: 'A', revenue_anno: 30 });
      expect((await listInterventi(2026))[0]).toMatchObject({ numero_if: 'A', revenue_anno: 0 });
    });

    it('returns the created record with the profiles it was given', async () => {
      const c = await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(1, 2, 3), anno: 2026 });
      expect(c).toMatchObject({ rev_mesi: m(1, 2, 3), cons_mesi: z, revenue_anno: 6 });
      expect(c).not.toHaveProperty('anno');
    });

    it('an IF created without months leaves no facts behind', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A' });
      expect(await listFacts()).toEqual([]);
      expect(await getIntervento('A', 2026)).toMatchObject({ rev_mesi: z, revenue_anno: 0 });
    });

    it('a duplicate IF is refused and writes nothing', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(1), anno: 2026 });
      await expect(createIntervento({ numero_if: 'A', titolo: 'B', rev_mesi: m(99), anno: 2026 })).rejects.toThrow();
      expect((await getIntervento('A', 2026))?.rev_mesi).toEqual(m(1));
    });

    it('an IF refused by validation writes no months either', async () => {
      await expect(createIntervento({ numero_if: 'A', titolo: 'A', importo: -1, rev_mesi: m(5), anno: 2026 })).rejects.toThrow();
      expect(await listFacts()).toEqual([]);
    });
  });

  describe('updating an IF', () => {
    const seed = () => createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(10), cons_mesi: m(0, 4), anno: 2026 });

    it('writes only the year it is told, leaving the others alone', async () => {
      await seed();
      await updateIntervento('A', { rev_mesi: m(1, 1), anno: 2025 });
      expect((await getIntervento('A', 2025))?.rev_mesi).toEqual(m(1, 1));
      expect((await getIntervento('A', 2026))?.rev_mesi).toEqual(m(10));
      expect((await getIntervento('A', 2026))?.cons_mesi).toEqual(m(0, 4));
    });

    it('sending one profile keeps the other one of that year', async () => {
      await seed();
      await updateIntervento('A', { rev_mesi: m(7), anno: 2026 });
      expect(await getIntervento('A', 2026)).toMatchObject({ rev_mesi: m(7), cons_mesi: m(0, 4) });
      await updateIntervento('A', { cons_mesi: m(0, 0, 9), anno: 2026 });
      expect(await getIntervento('A', 2026)).toMatchObject({ rev_mesi: m(7), cons_mesi: m(0, 0, 9) });
    });

    it('REGRESSION: editing other fields never touches the months', async () => {
      await seed();
      const u = await updateIntervento('A', { titolo: 'Nuovo titolo', importo: 5, anno: 2026 });
      expect(u).toMatchObject({ titolo: 'Nuovo titolo', rev_mesi: m(10), cons_mesi: m(0, 4), revenue_anno: 10 });
      await updateIntervento('A', { stato: 'approvato' }); // no year at all
      expect((await getIntervento('A', 2026))?.rev_mesi).toEqual(m(10));
    });

    it('the response carries the profiles of the year asked for', async () => {
      await seed();
      expect(await updateIntervento('A', { titolo: 'x', anno: 2030 })).toMatchObject({ rev_mesi: z, revenue_anno: 0 });
      expect(await updateIntervento('A', { titolo: 'y', anno: 2026 })).toMatchObject({ rev_mesi: m(10) });
    });

    it('an explicit all-zero profile clears the year and stores nothing (sparse)', async () => {
      await seed();
      await updateIntervento('A', { rev_mesi: z, cons_mesi: z, anno: 2026 });
      expect(await rowCount()).toBe(0);
      expect(await getIntervento('A', 2026)).toMatchObject({ rev_mesi: z, cons_mesi: z });
    });

    it('stores only the non-zero months', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(1, 0, 3), cons_mesi: m(0, 2), anno: 2026 });
      expect(await rowCount()).toBe(3); // Jan (rev), Feb (cons), Mar (rev)
    });

    it('an update that fails validation changes neither the IF nor its months', async () => {
      await seed();
      await expect(updateIntervento('A', { importo: -5, rev_mesi: m(99), anno: 2026 })).rejects.toThrow();
      expect((await getIntervento('A', 2026))?.rev_mesi).toEqual(m(10));
    });

    it('returns null for an unknown IF without writing anything', async () => {
      expect(await updateIntervento('nope', { rev_mesi: m(5), anno: 2026 })).toBeNull();
      expect(await listFacts()).toEqual([]);
    });

    it('normalises sloppy profiles (short, strings, NaN) to 12 finite numbers', async () => {
      await seed();
      await updateIntervento('A', { rev_mesi: [1, '2', NaN] as unknown as number[], anno: 2026 });
      expect((await getIntervento('A', 2026))?.rev_mesi).toEqual(m(1, 2));
    });
  });

  describe('the default year', () => {
    const put = (anno: number) => setIfYear('A', anno, m(1), z);
    beforeEach(async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A' });
    });

    it('is the current year when it has data', async () => {
      await put(CY - 1);
      await put(CY);
      await put(CY + 1);
      expect(await resolveAnno()).toBe(CY);
      expect((await listInterventi())[0].revenue_anno).toBe(1);
    });

    it('falls back to the closest earlier year, then the closest later one', async () => {
      await put(CY - 2);
      await put(CY - 1);
      expect(await resolveAnno()).toBe(CY - 1);
      await pgOrMemClear();
      await put(CY + 2);
      await put(CY + 1);
      expect(await resolveAnno()).toBe(CY + 1);
    });

    it('is the current year when there is no data at all', async () => {
      expect(await resolveAnno()).toBe(CY);
      expect(await listAnni()).toEqual([]);
    });

    it('an explicit valid year always wins; an invalid one means the default', async () => {
      await put(CY);
      expect(await resolveAnno(2031)).toBe(2031);
      expect(await resolveAnno('2031')).toBe(2031);
      for (const bad of ['abc', 1999, 2101, 2026.5, null, undefined, '']) expect(await resolveAnno(bad)).toBe(CY);
    });

    async function pgOrMemClear() {
      if (isDb) await pg.exec('TRUNCATE intervento_mesi');
      else (globalThis as Record<string, unknown>).__ARIA_MESI__ = new Map();
    }
  });

  describe('listing', () => {
    it('lists the years that have data, ascending', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A' });
      await setIfYear('A', 2027, m(1), z);
      await setIfYear('A', 2025, z, m(2));
      await setIfYear('A', 2027, m(1, 1), z);
      expect(await listAnni()).toEqual([2025, 2027]);
    });

    it('listMesiByAnno returns the arrays of one year per IF', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A' });
      await createIntervento({ numero_if: 'B', titolo: 'B' });
      await setIfYear('A', 2026, m(1), m(0, 2));
      await setIfYear('B', 2025, m(9), z);
      const y26 = await listMesiByAnno(2026);
      expect([...y26.keys()]).toEqual(['A']);
      expect(y26.get('A')).toEqual({ rev: m(1), cons: m(0, 2) });
      expect((await getIfMesi('B', 2025)).rev).toEqual(m(9));
      expect(await getIfMesi('B', 2026)).toEqual({ rev: z, cons: z });
    });

    it('soft-deleted IFs vanish from the list but their months stay stored', async () => {
      await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(5), anno: 2026 });
      await softDeleteIntervento('A');
      expect(await listInterventi(2026)).toEqual([]);
      expect(await listFacts()).toHaveLength(1);
    });
  });

  describe('REGRESSION: uploads of IF files never touch the months', () => {
    it('an IF_ARIA-style upload (no months) keeps the revenue already stored', async () => {
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Da Dashboard' })]);
      await persistMesiFromUpload([f('A', 2026, 1, 100), f('A', 2026, 2, 50)]);
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Da IF_ARIA', ambito: 'Sviluppo' })]);
      expect(await getIntervento('A', 2026)).toMatchObject({ titolo: 'Da IF_ARIA', rev_mesi: m(100, 50), revenue_anno: 150 });
    });

    it('revives a soft-deleted IF together with its months', async () => {
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A' })]);
      await persistMesiFromUpload([f('A', 2026, 3, 7)]);
      await softDeleteIntervento('A');
      await upsertInterventiFromUpload([makeIf({ numero_if: 'A', titolo: 'Ritorno' })]);
      expect(await getIntervento('A', 2026)).toMatchObject({ titolo: 'Ritorno', rev_mesi: m(0, 0, 7) });
    });
  });

  describe('persistMesiFromUpload', () => {
    it('writes the facts of new IFs, per year', async () => {
      const res = await persistMesiFromUpload([f('A', 2026, 1, 10), f('A', 2027, 1, 20), f('B', 2026, 12, 5)]);
      expect(res).toEqual({ groups: 3, rows: 3 });
      expect((await getIfMesi('A', 2026)).rev).toEqual(m(10));
      expect((await getIfMesi('A', 2027)).rev).toEqual(m(20));
      expect((await getIfMesi('B', 2026)).rev).toEqual([...Array(11).fill(0), 5]);
    });

    it('REGRESSION: revenue is replaced as a whole when the file has any, consuntivazione is kept', async () => {
      await setIfYear('A', 2026, m(1, 2, 3), m(0, 9));
      await persistMesiFromUpload([f('A', 2026, 1, 5)]);
      expect(await getIfMesi('A', 2026)).toEqual({ rev: m(5), cons: m(0, 9) });
    });

    it('a file with consuntivazione but no revenue replaces only the consuntivazione', async () => {
      await setIfYear('A', 2026, m(1, 2), m(3));
      await persistMesiFromUpload([f('A', 2026, 2, 0, 8)]);
      expect(await getIfMesi('A', 2026)).toEqual({ rev: m(1, 2), cons: m(0, 8) });
    });

    it('never touches years or IFs the file does not mention', async () => {
      await setIfYear('A', 2025, m(1), z);
      await setIfYear('A', 2026, m(2), z);
      await setIfYear('B', 2026, m(3), z);
      await persistMesiFromUpload([f('A', 2026, 1, 99)]);
      expect((await getIfMesi('A', 2025)).rev).toEqual(m(1));
      expect((await getIfMesi('A', 2026)).rev).toEqual(m(99));
      expect((await getIfMesi('B', 2026)).rev).toEqual(m(3));
    });

    it('ignores the IFs it is told to skip (manually edited ones)', async () => {
      await setIfYear('A', 2026, m(1), z);
      const res = await persistMesiFromUpload([f('A', 2026, 1, 99), f('B', 2026, 1, 5)], new Set(['A']));
      expect(res.groups).toBe(1);
      expect((await getIfMesi('A', 2026)).rev).toEqual(m(1));
      expect((await getIfMesi('B', 2026)).rev).toEqual(m(5));
    });

    it('sums repeated (IF, year, month) facts', async () => {
      await persistMesiFromUpload([f('A', 2026, 1, 10, 1), f('A', 2026, 1, 5, 2)]);
      expect(await getIfMesi('A', 2026)).toEqual({ rev: m(15), cons: m(3) });
    });

    it('drops invalid facts and never lets one bad row sink the batch', async () => {
      const res = await persistMesiFromUpload([
        f('A', 1999, 1, 1),
        f('A', 2101, 1, 1),
        f('A', 2026, 0, 1),
        f('A', 2026, 13, 1),
        f('A', 2026, 1.5, 1),
        f('', 2026, 1, 1),
        f('A', 2026, 2, NaN, Infinity),
        f('A', 2026, 3, 4),
      ]);
      expect(res).toEqual({ groups: 1, rows: 1 });
      expect(await getIfMesi('A', 2026)).toEqual({ rev: m(0, 0, 4), cons: z });
    });

    it('all-zero facts change nothing and store nothing', async () => {
      await setIfYear('A', 2026, m(1), z);
      expect(await persistMesiFromUpload([f('A', 2026, 1, 0, 0), f('B', 2026, 1, 0, 0)])).toEqual({ groups: 0, rows: 0 });
      expect((await getIfMesi('A', 2026)).rev).toEqual(m(1));
      expect(await rowCount()).toBe(1);
    });

    it('is idempotent: the same upload twice leaves the same state', async () => {
      const upload = [f('A', 2026, 1, 10, 2), f('A', 2026, 2, 5), f('B', 2025, 6, 7)];
      await persistMesiFromUpload(upload);
      const first = (await listFacts()).sort((a, b) => a.numero_if.localeCompare(b.numero_if) || a.anno - b.anno || a.mese - b.mese);
      await persistMesiFromUpload(upload);
      const second = (await listFacts()).sort((a, b) => a.numero_if.localeCompare(b.numero_if) || a.anno - b.anno || a.mese - b.mese);
      expect(second).toEqual(first);
      expect(second).toHaveLength(3); // a month with revenue AND consuntivo is a single row
    });

    it('handles a large portfolio (many IFs and years in one upload)', async () => {
      const facts: MonthFact[] = [];
      for (let i = 0; i < 700; i++) for (const y of [2026, 2027]) facts.push(f(`IF${i}`, y, 1 + (i % 12), i + 1));
      const res = await persistMesiFromUpload(facts);
      expect(res).toEqual({ groups: 1400, rows: 1400 });
      expect(await rowCount()).toBe(1400);
      await persistMesiFromUpload(facts);
      expect(await rowCount()).toBe(1400);
      expect((await getIfMesi('IF699', 2027)).rev[(699 % 12)]).toBe(700);
    }, 60_000);
  });

  if (isDb) {
    describe('database constraints', () => {
      it('rejects a month outside 1..12 and a duplicate (IF, year, month)', async () => {
        await expect(pg.exec(`insert into intervento_mesi values ('A', 2026, 13, 1, 0)`)).rejects.toThrow();
        await expect(pg.exec(`insert into intervento_mesi values ('A', 2026, 0, 1, 0)`)).rejects.toThrow();
        await pg.exec(`insert into intervento_mesi values ('A', 2026, 1, 1, 0)`);
        await expect(pg.exec(`insert into intervento_mesi values ('A', 2026, 1, 2, 0)`)).rejects.toThrow();
      });

      it('a failing batch leaves nothing half-written (the IF and its months are one transaction)', async () => {
        await createIntervento({ numero_if: 'A', titolo: 'A', rev_mesi: m(1), anno: 2026 });
        // A second IF with the same numero_if violates the unique key AFTER its months statement was queued.
        await expect(createIntervento({ numero_if: 'A', titolo: 'dup', rev_mesi: m(50), anno: 2027 })).rejects.toThrow();
        expect(await listAnni()).toEqual([2026]);
      });

      it('has the (anno, numero_if) index the year-wise reads rely on', async () => {
        const r = await pg.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'intervento_mesi'`);
        expect(r.rows.map((x) => x.indexname)).toContain('intervento_mesi_anno_if_idx');
      });
    });
  }
});
