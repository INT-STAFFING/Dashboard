// Generic, DB-backed key/value settings with an in-memory fallback.
//
// Mirrors the dual-mode pattern used by lib/store.ts: when a Neon connection
// string is configured the values are persisted in the `app_config` table
// (one JSON row per key); otherwise they live in a per-instance global seeded
// from lib/seed.ts so the app still works with zero configuration.
import { sql } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';

const g = globalThis as unknown as { __ARIA_CFG__?: Record<string, unknown> };
function memStore(): Record<string, unknown> {
  if (!g.__ARIA_CFG__) g.__ARIA_CFG__ = {};
  return g.__ARIA_CFG__;
}

// Deep clone so callers can't mutate the cached/seed object in place.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function getSetting<T>(key: string, seed: T): Promise<T> {
  const mem = memStore();
  if (hasDB) {
    try {
      await ensureSchema();
      const rows = (await getDb().execute(
        sql`select value from app_config where key = ${key} limit 1`,
      )) as unknown as { rows?: { value: unknown }[] } | { value: unknown }[];
      const list = Array.isArray(rows) ? rows : rows.rows ?? [];
      if (list.length && list[0].value != null) {
        const val = list[0].value as T;
        mem[key] = val;
        return clone(val);
      }
    } catch {
      // fall through to in-memory / seed
    }
  }
  if (key in mem) return clone(mem[key] as T);
  mem[key] = clone(seed);
  return clone(seed);
}

export async function setSetting<T>(key: string, value: T): Promise<T> {
  const mem = memStore();
  mem[key] = clone(value);
  if (hasDB) {
    try {
      await ensureSchema();
      const json = JSON.stringify(value);
      await getDb().execute(
        sql`insert into app_config (key, value, updated_at)
            values (${key}, ${json}::jsonb, now())
            on conflict (key) do update set value = ${json}::jsonb, updated_at = now()`,
      );
    } catch {
      // keep the in-memory value even if persistence fails
    }
  }
  return clone(value);
}
