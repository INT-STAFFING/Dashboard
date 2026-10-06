import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { POST } from '@/app/api/admin/db/query/route';
import { applyMigration, createTestDb } from './helpers/pglite';
import { getCachedUser, invalidateAllUsers } from '@/lib/auth/userCache';

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

let pg: PGlite;
beforeAll(async () => {
  const t = await createTestDb();
  pg = t.pg;
  state.db = t.db;
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  state.hasDB = true;
  state.user = ADMIN;
  await pg.exec('DROP TABLE IF EXISTS admin_audit_log, side_effect');
  await applyMigration(pg, '0012_login_attempts_admin_audit.sql');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const run = (query: unknown) =>
  POST(new Request('http://localhost/api/admin/db/query', { method: 'POST', body: JSON.stringify({ query }) }));
const audit = async () => (await pg.query<Record<string, unknown>>('select * from admin_audit_log order by id')).rows;

describe('POST /api/admin/db/query', () => {
  it('REGRESSION: an admin gets rows, rowCount and duration back', async () => {
    const res = await run('select 1 as x, 2 as y');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, rows: [{ x: 1, y: 2 }], rowCount: 1 });
    expect(typeof body.durationMs).toBe('number');
  });

  it('REGRESSION: non-admins are refused and nothing is logged or executed', async () => {
    state.user = USER;
    expect((await run('select 1')).status).toBe(403);
    state.user = null;
    expect((await run('select 1')).status).toBe(403);
    expect(await audit()).toHaveLength(0);
  });

  it('REGRESSION: no database -> 503; empty query and chained statements -> 400, none audited', async () => {
    expect((await run('')).status).toBe(400);
    expect((await run('select 1; select 2')).status).toBe(400);
    expect(await audit()).toHaveLength(0);
    state.hasDB = false;
    expect((await run('select 1')).status).toBe(503);
  });

  it('records who ran which statement and how it went', async () => {
    await run('select 1 as x');
    const [row] = await audit();
    expect(row).toMatchObject({ user_id: 1, user_email: 'admin@x.it', action: 'sql', statement: 'select 1 as x', status: 'ok', error: null });
    expect(Number(row.row_count)).toBe(1);
    expect(row.duration_ms).not.toBeNull();
    expect(row.created_at).toBeTruthy();
  });

  it('records failing statements with their error, and still answers 400', async () => {
    const res = await run('select * from table_that_does_not_exist');
    expect(res.status).toBe(400);
    const [row] = await audit();
    expect(row.status).toBe('error');
    expect(String(row.error)).toMatch(/table_that_does_not_exist/);
  });

  it('records data-changing statements too, in order', async () => {
    await run('create table side_effect (id int)');
    await run('insert into side_effect values (1)');
    const rows = await audit();
    expect(rows.map((r) => r.statement)).toEqual(['create table side_effect (id int)', 'insert into side_effect values (1)']);
    expect(rows.every((r) => r.status === 'ok')).toBe(true);
  });

  it('truncates a very long statement in the log but still runs it whole', async () => {
    const long = `select '${'a'.repeat(25_000)}' as big`;
    const res = await run(long);
    expect(res.status).toBe(200);
    const [row] = await audit();
    expect(String(row.statement).length).toBeLessThan(long.length);
    expect(String(row.statement)).toMatch(/\[troncato\]$/);
  });

  it('FAILS CLOSED: if the audit row cannot be written the statement is NOT executed', async () => {
    await pg.exec('DROP TABLE admin_audit_log');
    const res = await run('create table side_effect (id int)');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Audit/);
    const exists = await pg.query("select to_regclass('public.side_effect') as t");
    expect((exists.rows[0] as { t: unknown }).t).toBeNull();
  });

  it('a failure while closing the audit row does not turn a successful query into an error', async () => {
    const real = state.db as { update: (...a: unknown[]) => unknown };
    const spy = vi.spyOn(real, 'update').mockImplementation(() => { throw new Error('update failed'); });
    const res = await run('select 1 as x');
    expect(res.status).toBe(200);
    spy.mockRestore();
    expect((await audit())[0].status).toBe('started');
  });

  it('drops every cached session user after a successful statement (it may have edited `users`)', async () => {
    invalidateAllUsers();
    const load = vi.fn(async () => ({ id: 7, email: 'c@x.it', name: null, role: 'USER' as const, status: 'approved' as const, created_at: null, approved_at: null }));
    await getCachedUser(7, load);
    await getCachedUser(7, load);
    expect(load).toHaveBeenCalledTimes(1);
    await run('select 1');
    await getCachedUser(7, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the cache when the statement fails', async () => {
    invalidateAllUsers();
    const load = vi.fn(async () => ({ id: 8, email: 'd@x.it', name: null, role: 'USER' as const, status: 'approved' as const, created_at: null, approved_at: null }));
    await getCachedUser(8, load);
    await run('select * from nope_nope');
    await getCachedUser(8, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
