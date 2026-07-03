import { getDb, hasDB, ensureSchema } from './db';
import { verbali_sal } from './schema';
import type { VerbaleSalRecord } from './types';

// Snapshot of the "REPORT Sal" export. Multiple rows per num_bdo are expected
// (periodic SAL over time), so every upload is a plain append — no upsert,
// no dedup. DB-backed with an in-memory fallback.
const g = globalThis as unknown as { __ARIA_VERBALI_SAL__?: VerbaleSalRecord[] };
function mem(): VerbaleSalRecord[] {
  if (!g.__ARIA_VERBALI_SAL__) g.__ARIA_VERBALI_SAL__ = [];
  return g.__ARIA_VERBALI_SAL__;
}

function toRow(r: VerbaleSalRecord): typeof verbali_sal.$inferInsert {
  return { ...r, updated_at: new Date() };
}

export async function persistVerbaliSalFromUpload(
  rows: VerbaleSalRecord[],
): Promise<{ saved: number }> {
  if (!rows.length) return { saved: 0 };

  if (hasDB) {
    await ensureSchema();
    await getDb().insert(verbali_sal).values(rows.map(toRow));
    return { saved: rows.length };
  }

  mem().push(...rows);
  return { saved: rows.length };
}
