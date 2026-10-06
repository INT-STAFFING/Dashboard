import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DDL, INTERVENTO_MESI_BACKFILL, SCHEMA_VERSION, applySchema } from '@/lib/db';
import { applyMigration, createTestDb } from './helpers/pglite';

// The monthly profiles moved from jsonb arrays on `interventi` (one year only) to
// the `intervento_mesi` table. These tests start from a database in the OLD shape
// and check that the data comes across exactly once, in the right year.
let pg: PGlite;
let db: Awaited<ReturnType<typeof createTestDb>>['db'];

beforeEach(async () => {
  const t = await createTestDb();
  pg = t.pg;
  db = t.db;
});
afterEach(async () => {
  await pg.close();
});

type Fact = { numero_if: string; anno: number; mese: number; revenue: number; consuntivo: number };
const facts = async (): Promise<Fact[]> =>
  (
    await pg.query<{ numero_if: string; anno: number; mese: number; revenue: string; consuntivo: string }>(
      'select * from intervento_mesi order by numero_if, anno, mese',
    )
  ).rows.map((r) => ({ ...r, revenue: Number(r.revenue), consuntivo: Number(r.consuntivo) }));

const arr = (...v: number[]) => JSON.stringify([...v, ...Array(12 - v.length).fill(0)]);

// A database as the previous version of the app left it: the full schema, with
// interventi carrying the old arrays, and the new table not there yet.
async function legacyDatabase(timelineAnno?: number) {
  await applySchema(db as never);
  await pg.exec('DROP TABLE intervento_mesi');
  await pg.exec(`DELETE FROM app_config WHERE key = 'schema_version'`);
  if (timelineAnno !== undefined) {
    await pg.exec(`INSERT INTO app_config (key, value) VALUES ('timeline', '{"anno": ${timelineAnno}, "mesi": []}'::jsonb)`);
  }
  await pg.exec(`
    INSERT INTO interventi (numero_if, titolo, rev_mesi, cons_mesi) VALUES
      ('20260001', 'Con ricavi e consuntivo', '${arr(100, 0, 50.5)}'::jsonb, '${arr(0, 7)}'::jsonb),
      ('20260002', 'Solo ricavi', '${arr(0, 0, 0, 12)}'::jsonb, NULL),
      ('20260003', 'Tutto a zero', '${arr()}'::jsonb, '${arr()}'::jsonb),
      ('20260004', 'Senza profili', NULL, NULL),
      ('20260005', 'Profilo non valido', '{"oops": true}'::jsonb, '"testo"'::jsonb)`);
}

describe('applySchema on an empty database (the production bootstrap)', () => {
  it('creates everything, including the new table, and stamps the schema version', async () => {
    await applySchema(db as never);
    const tables = (await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
    for (const t of ['interventi', 'intervento_mesi', 'timeline_mensile', 'users', 'login_attempts', 'admin_audit_log']) expect(tables).toContain(t);
    const v = await pg.query<{ value: number }>(`select value from app_config where key = 'schema_version'`);
    expect(Number(v.rows[0].value)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
  });

  it('is idempotent: running it again changes nothing', async () => {
    await applySchema(db as never);
    await pg.exec(`INSERT INTO intervento_mesi VALUES ('A', 2026, 1, 5, 0)`);
    await applySchema(db as never);
    await applySchema(db as never);
    expect(await facts()).toEqual([{ numero_if: 'A', anno: 2026, mese: 1, revenue: 5, consuntivo: 0 }]);
  });

  it('ends with the backfill, after the identifier repairs', () => {
    expect(DDL[DDL.length - 1]).toBe(INTERVENTO_MESI_BACKFILL);
  });
});

describe('backfill of the legacy profiles', () => {
  it('copies every non-zero month, sparsely, under the timeline year', async () => {
    await legacyDatabase(2025);
    await applySchema(db as never);
    expect(await facts()).toEqual([
      { numero_if: '20260001', anno: 2025, mese: 1, revenue: 100, consuntivo: 0 },
      { numero_if: '20260001', anno: 2025, mese: 2, revenue: 0, consuntivo: 7 },
      { numero_if: '20260001', anno: 2025, mese: 3, revenue: 50.5, consuntivo: 0 },
      { numero_if: '20260002', anno: 2025, mese: 4, revenue: 12, consuntivo: 0 },
    ]);
  });

  it('REGRESSION: the totals per IF are exactly what the old arrays held', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    const sum = async (id: string, col: 'revenue' | 'consuntivo') =>
      Number((await pg.query<{ s: string }>(`select coalesce(sum(${col}), 0) as s from intervento_mesi where numero_if = $1`, [id])).rows[0].s);
    expect(await sum('20260001', 'revenue')).toBe(150.5);
    expect(await sum('20260001', 'consuntivo')).toBe(7);
    expect(await sum('20260002', 'revenue')).toBe(12);
    expect(await sum('20260003', 'revenue')).toBe(0);
  });

  it('falls back to 2026 when no timeline year is configured', async () => {
    await legacyDatabase();
    await applySchema(db as never);
    expect([...new Set((await facts()).map((f) => f.anno))]).toEqual([2026]);
  });

  it('copes with IFs that have no profile, a zero profile, or a malformed one (no row, no error)', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    const ids = new Set((await facts()).map((f) => f.numero_if));
    expect([...ids].sort()).toEqual(['20260001', '20260002']);
  });

  it('leaves the legacy columns untouched', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    const r = await pg.query<{ rev_mesi: number[] }>(`select rev_mesi from interventi where numero_if = '20260001'`);
    expect(r.rows[0].rev_mesi[0]).toBe(100);
  });

  it('runs once: a later schema bump does not resurrect or duplicate months', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    // The user edits the data afterwards through the app…
    await pg.exec(`DELETE FROM intervento_mesi WHERE numero_if = '20260001' AND mese = 1`);
    await pg.exec(`UPDATE intervento_mesi SET revenue = 999 WHERE numero_if = '20260002'`);
    const before = await facts();
    // …and a future version bumps the schema: the whole DDL runs again.
    await pg.exec(`DELETE FROM app_config WHERE key = 'schema_version'`);
    await applySchema(db as never);
    expect(await facts()).toEqual(before);
  });

  it('does not run when the table already has data (a database already on the new model)', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    await pg.exec('TRUNCATE intervento_mesi');
    await pg.exec(`INSERT INTO intervento_mesi VALUES ('X', 2030, 5, 1, 1)`);
    await pg.exec(`DELETE FROM app_config WHERE key = 'schema_version'`);
    await applySchema(db as never);
    expect(await facts()).toEqual([{ numero_if: 'X', anno: 2030, mese: 5, revenue: 1, consuntivo: 1 }]);
  });

  it('survives two instances bootstrapping at the same time (ON CONFLICT DO NOTHING)', async () => {
    await legacyDatabase(2026);
    await applySchema(db as never);
    const before = await facts();
    // Simulate the second instance reaching the backfill with the table non-empty only by
    // another instance's rows: replay the statement on an emptied table twice in a row.
    await pg.exec('TRUNCATE intervento_mesi');
    await pg.exec(INTERVENTO_MESI_BACKFILL);
    await pg.exec('SELECT 1'); // the second run is a no-op because the table is no longer empty
    await pg.exec(INTERVENTO_MESI_BACKFILL);
    expect(await facts()).toEqual(before);
  });

  it('copies the REPAIRED identifiers (the backfill runs after the Date-string repair)', async () => {
    await applySchema(db as never);
    await pg.exec('DROP TABLE intervento_mesi');
    await pg.exec(`DELETE FROM app_config WHERE key = 'schema_version'`);
    // 20260323 stored the way the old bug left it: the Excel serial read as a calendar date.
    await pg.exec(`INSERT INTO interventi (numero_if, titolo, rev_mesi) VALUES ('Fri Nov 16 57370 00:00:00 GMT+0100 (CET)', 'rotto', '${arr(5)}'::jsonb)`);
    await applySchema(db as never);
    expect((await facts()).map((f) => f.numero_if)).toEqual(['20260323']);
  });
});

describe('drizzle/0013_intervento_mesi.sql', () => {
  const sqlOf = (file: string) => readFileSync(fileURLToPath(new URL(`../drizzle/${file}`, import.meta.url)), 'utf8');
  const squash = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

  it('contains the same backfill statement as lib/db.ts (no drift)', () => {
    expect(squash(sqlOf('0013_intervento_mesi.sql'))).toContain(squash(INTERVENTO_MESI_BACKFILL));
  });

  it('upgrades a legacy database on its own, with the same result as the bootstrap', async () => {
    // Only what the migration needs from the old world: interventi, app_config.
    await pg.exec(`CREATE TABLE app_config (key text PRIMARY KEY, value jsonb, updated_at timestamp DEFAULT now())`);
    await pg.exec(`CREATE TABLE interventi (id serial PRIMARY KEY, numero_if text NOT NULL, titolo text NOT NULL, rev_mesi jsonb, cons_mesi jsonb)`);
    await pg.exec(`INSERT INTO app_config (key, value) VALUES ('timeline', '{"anno": 2025}'::jsonb)`);
    await pg.exec(`INSERT INTO interventi (numero_if, titolo, rev_mesi, cons_mesi) VALUES ('A', 'a', '${arr(10, 20)}'::jsonb, '${arr(0, 0, 3)}'::jsonb)`);
    await applyMigration(pg, '0013_intervento_mesi.sql');
    expect(await facts()).toEqual([
      { numero_if: 'A', anno: 2025, mese: 1, revenue: 10, consuntivo: 0 },
      { numero_if: 'A', anno: 2025, mese: 2, revenue: 20, consuntivo: 0 },
      { numero_if: 'A', anno: 2025, mese: 3, revenue: 0, consuntivo: 3 },
    ]);
    // Running it again is harmless.
    await applyMigration(pg, '0013_intervento_mesi.sql');
    expect(await facts()).toHaveLength(3);
  });

  it('is listed in the migrations journal', () => {
    const journal = JSON.parse(sqlOf('meta/_journal.json')) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain('0013_intervento_mesi');
  });
});
