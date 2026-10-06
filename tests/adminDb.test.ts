import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { PGlite } from '@electric-sql/pglite';
import { applySchema } from '@/lib/db';
import { GET as exportRoute } from '@/app/api/admin/db/export/route';
import { GET as tableRoute } from '@/app/api/admin/db/table/[name]/route';
import { GET as tablesRoute } from '@/app/api/admin/db/tables/route';
import { collectAllTables } from '@/lib/dbExport';
import { persistMesiFromUpload } from '@/lib/mesiStore';
import { SEED_INTERVENTI, SEED_MESI } from '@/lib/seed';
import { createTestDb } from './helpers/pglite';

const state = vi.hoisted(() => ({
  hasDB: true,
  db: null as unknown,
  user: null as null | { id: number; email: string; role: string; status: string },
}));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, get hasDB() { return state.hasDB; }, getDb: () => state.db, ensureSchema: async () => {} };
});
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSessionUser: async () => state.user };
});
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const ADMIN = { id: 1, email: 'admin@x.it', role: 'ADMIN', status: 'approved' };
const USER = { id: 2, email: 'user@x.it', role: 'USER', status: 'approved' };
const NEW_TABLES = ['intervento_mesi', 'login_attempts', 'admin_audit_log'];

let pg: PGlite;
beforeAll(async () => {
  const t = await createTestDb();
  pg = t.pg;
  state.db = t.db;
  await applySchema(t.db as never);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  state.hasDB = true;
  state.user = ADMIN;
});

const req = (url: string) => new Request(`http://localhost${url}`);
const table = (name: string, qs = '') => tableRoute(req(`/api/admin/db/table/${encodeURIComponent(name)}${qs}`), { params: { name } } as never);

describe('GET /api/admin/db/tables', () => {
  it('is for admins only, and needs a database', async () => {
    state.user = USER;
    expect((await tablesRoute()).status).toBe(403);
    state.user = ADMIN;
    state.hasDB = false;
    expect((await tablesRoute()).status).toBe(503);
  });

  it('lists the public tables alphabetically, including the new ones, with their column counts', async () => {
    const body = await (await tablesRoute()).json();
    const names = body.tables.map((t: { name: string }) => t.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    for (const t of ['interventi', 'users', ...NEW_TABLES]) expect(names).toContain(t);
    const mesi = body.tables.find((t: { name: string }) => t.name === 'intervento_mesi');
    expect(mesi.columnCount).toBe(5);
  });

  it('REGRESSION: a table that was never analysed (just created) reports 0 rows, never a negative count', async () => {
    for (const t of (await (await tablesRoute()).json()).tables) expect(t.approxRows).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/admin/db/table/[name]', () => {
  beforeEach(async () => {
    await pg.exec('TRUNCATE intervento_mesi');
    await pg.exec(`INSERT INTO intervento_mesi SELECT 'IF' || g, 2026, 1 + (g % 12), g, 0 FROM generate_series(1, 120) g`);
  });

  it('is for admins only', async () => {
    state.user = USER;
    expect((await table('intervento_mesi')).status).toBe(403);
  });

  it('describes the columns and returns the first page with the total', async () => {
    const body = await (await table('intervento_mesi')).json();
    expect(body.columns.map((c: { column_name: string }) => c.column_name)).toEqual(['numero_if', 'anno', 'mese', 'revenue', 'consuntivo']);
    expect(body).toMatchObject({ ok: true, total: 120, limit: 50, offset: 0 });
    expect(body.rows).toHaveLength(50);
  });

  it('paginates, and clamps the page size to 200 and the offset to 0', async () => {
    expect((await (await table('intervento_mesi', '?limit=10&offset=115')).json()).rows).toHaveLength(5);
    expect((await (await table('intervento_mesi', '?limit=100000')).json()).limit).toBe(200);
    expect((await (await table('intervento_mesi', '?limit=-3&offset=-9')).json())).toMatchObject({ limit: 1, offset: 0 });
    expect((await (await table('intervento_mesi', '?limit=abc')).json()).limit).toBe(50);
  });

  it('REGRESSION: only real tables can be read — anything else, injection attempts included, is a 404', async () => {
    for (const bad of ['nope', 'users; DROP TABLE users', '"intervento_mesi"', "x' OR '1'='1", 'pg_catalog.pg_class', '']) {
      expect((await table(bad)).status).toBe(404);
    }
    expect((await pg.query(`select 1 from users limit 1`)).rows).toBeDefined(); // still there
  });
});

describe('GET /api/admin/db/export', () => {
  const read = async (res: Response) => XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' });

  it('is for admins only', async () => {
    state.user = USER;
    expect((await exportRoute()).status).toBe(403);
  });

  it('REGRESSION: the download is a real zip archive (it used to be a file of zeros Excel could not open)', async () => {
    const bytes = new Uint8Array(await (await exportRoute()).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // "PK"
    expect(bytes.some((b) => b !== 0)).toBe(true);
  });

  it('returns an .xlsx with an index sheet first and one sheet per table, rows included', async () => {
    await pg.exec('TRUNCATE intervento_mesi');
    await pg.exec(`INSERT INTO intervento_mesi VALUES ('A', 2026, 1, 10.5, 2), ('A', 2027, 3, 4, 0)`);
    const res = await exportRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toMatch(/Database_ARIA_SISS_\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = await read(res);
    expect(wb.SheetNames[0]).toBe('_Indice');
    for (const t of ['interventi', 'users', ...NEW_TABLES]) expect(wb.SheetNames).toContain(t);
    const idx = XLSX.utils.sheet_to_json<{ Tabella: string; Colonne: number; Righe: number }>(wb.Sheets['_Indice']);
    expect(idx.find((r) => r.Tabella === 'intervento_mesi')).toMatchObject({ Colonne: 5, Righe: 2 });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['intervento_mesi']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ numero_if: 'A', anno: 2026, mese: 1 });
  });

  it('flattens JSON columns to text so the cell stays readable', async () => {
    await pg.exec(`TRUNCATE app_config; INSERT INTO app_config (key, value) VALUES ('k', '{"a": [1, 2]}'::jsonb)`);
    const wb = await read(await exportRoute());
    const rows = XLSX.utils.sheet_to_json<{ key: string; value: string }>(wb.Sheets['app_config']);
    expect(rows.find((r) => r.key === 'k')!.value).toBe('{"a":[1,2]}');
  });
});

describe('collectAllTables', () => {
  it('in database mode introspects the public schema, tables sorted, empty ones included', async () => {
    const tables = await collectAllTables();
    const names = tables.map((t) => t.table);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const mesi = tables.find((t) => t.table === 'intervento_mesi')!;
    expect(mesi.columns).toEqual(['numero_if', 'anno', 'mese', 'revenue', 'consuntivo']);
  });

  describe('in memory mode', () => {
    beforeEach(() => {
      state.hasDB = false;
      const g = globalThis as Record<string, unknown>;
      delete g.__ARIA_MEM__;
      delete g.__ARIA_MESI__;
    });

    it('dumps the same tables the dashboard reads, including the monthly facts', async () => {
      const tables = await collectAllTables();
      const names = tables.map((t) => t.table);
      for (const t of ['interventi', 'intervento_mesi', 'bef_records', 'timeline_mensile', 'users', 'app_config', 'report_pdc', 'verbali_sal']) expect(names).toContain(t);
      expect(tables.find((t) => t.table === 'interventi')!.rows).toHaveLength(SEED_INTERVENTI.length);
      expect(tables.find((t) => t.table === 'intervento_mesi')!.rows).toHaveLength(SEED_MESI.length);
    });

    it('REGRESSION: months added through the app show up in the export, every year of them', async () => {
      await persistMesiFromUpload([{ numero_if: SEED_INTERVENTI[0].numero_if, anno: 2031, mese: 5, revenue: 7, consuntivo: 1 }]);
      const rows = (await collectAllTables()).find((t) => t.table === 'intervento_mesi')!.rows;
      expect(rows).toContainEqual({ numero_if: SEED_INTERVENTI[0].numero_if, anno: 2031, mese: 5, revenue: 7, consuntivo: 1 });
    });

    it('an empty table still lists its columns', async () => {
      await persistMesiFromUpload([]);
      (globalThis as Record<string, unknown>).__ARIA_MESI__ = new Map();
      const mesi = (await collectAllTables()).find((t) => t.table === 'intervento_mesi')!;
      expect(mesi.rows).toEqual([]);
      expect(mesi.columns).toEqual(['numero_if', 'anno', 'mese', 'revenue', 'consuntivo']);
    });
  });
});
