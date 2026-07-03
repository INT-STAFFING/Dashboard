import { inArray } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { verbali_apertura } from './schema';
import type { VerbaleAperturaRecord } from './types';

// Snapshot of the "REPORT Apertura" export. No natural UNIQUE key (num_bdo can
// legitimately repeat), so re-running the same upload is made idempotent by
// deleting every row whose num_bdo appears in the incoming batch before
// re-inserting it. DB-backed with an in-memory fallback.
const g = globalThis as unknown as { __ARIA_VERBALI_APERTURA__?: VerbaleAperturaRecord[] };
function mem(): VerbaleAperturaRecord[] {
  if (!g.__ARIA_VERBALI_APERTURA__) g.__ARIA_VERBALI_APERTURA__ = [];
  return g.__ARIA_VERBALI_APERTURA__;
}

function toRow(r: VerbaleAperturaRecord): typeof verbali_apertura.$inferInsert {
  return { ...r, updated_at: new Date() };
}

export async function persistVerbaliAperturaFromUpload(
  rows: VerbaleAperturaRecord[],
): Promise<{ saved: number }> {
  if (!rows.length) return { saved: 0 };
  const bdoList = [...new Set(rows.map((r) => r.num_bdo).filter((v): v is string => !!v))];

  if (hasDB) {
    await ensureSchema();
    const db = getDb();
    if (bdoList.length) {
      await db.delete(verbali_apertura).where(inArray(verbali_apertura.num_bdo, bdoList));
    }
    await db.insert(verbali_apertura).values(rows.map(toRow));
    return { saved: rows.length };
  }

  const kept = mem().filter((r) => !r.num_bdo || !bdoList.includes(r.num_bdo));
  kept.push(...rows);
  g.__ARIA_VERBALI_APERTURA__ = kept;
  return { saved: rows.length };
}
