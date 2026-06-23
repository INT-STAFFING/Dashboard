import { drizzle } from 'drizzle-orm/vercel-postgres';
import { sql } from '@vercel/postgres';
import * as schema from './schema';

// The app works in two modes:
//  - With POSTGRES_URL set  -> Drizzle / Vercel Postgres (persistent)
//  - Without it             -> in-memory seed store (ephemeral, zero-config dev)
export const hasDB = Boolean(
  process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING,
);

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!hasDB) {
    throw new Error('Database not configured (POSTGRES_URL missing).');
  }
  if (!_db) {
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export { schema };
