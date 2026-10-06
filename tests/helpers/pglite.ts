import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/schema';

// In-process Postgres standing in for Neon. `batch` is emulated with a real
// BEGIN/COMMIT so it keeps the all-or-nothing semantics of neon-http's batch.
export async function createTestDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const withBatch = Object.assign(db, {
    batch: async (stmts: PromiseLike<unknown>[]) => {
      await pg.exec('BEGIN');
      try {
        const out: unknown[] = [];
        for (const s of stmts) out.push(await s);
        await pg.exec('COMMIT');
        return out;
      } catch (e) {
        await pg.exec('ROLLBACK');
        throw e;
      }
    },
  });
  return { pg, db: withBatch };
}

// Applies one of the repo's own drizzle/*.sql migrations, so tests run against
// the real DDL instead of a hand-copied one.
export async function applyMigration(pg: PGlite, file: string): Promise<void> {
  const sqlText = readFileSync(fileURLToPath(new URL(`../../drizzle/${file}`, import.meta.url)), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint')) {
    if (stmt.replace(/--.*$/gm, '').trim()) await pg.exec(stmt);
  }
}
