import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

// Neon serverless Postgres connection string. The Vercel ⇄ Neon integration
// exposes it as DATABASE_URL (and POSTGRES_URL for backwards compatibility).
export const connectionString =
  process.env.DASH_DATABASE_URL ||
  process.env.DASH_POSTGRES_URL ||
  process.env.DASH_DATABASE_URL_UNPOOLED ||
  process.env.DASH_POSTGRES_URL_NON_POOLING ||
  '';

// Two modes:
//  - With a Neon connection string -> Drizzle / neon-http (persistent)
//  - Without it                    -> in-memory seed store (ephemeral, zero-config)
export const hasDB = Boolean(connectionString);

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!hasDB) {
    throw new Error('Database non configurato (DATABASE_URL / POSTGRES_URL mancante).');
  }
  if (!_db) {
    const sql = neon(connectionString);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export { schema };
