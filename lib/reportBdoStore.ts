import { getDb, hasDB, ensureSchema } from './db';
import { report_bdo } from './schema';
import type { ReportBdoRecord } from './types';

// Snapshot of the "REPORT Bdo" export, one row per num_bdo. DB-backed with an
// in-memory fallback (mirrors lib/befStore.ts).
const g = globalThis as unknown as { __ARIA_REPORT_BDO__?: Map<string, ReportBdoRecord> };
function mem(): Map<string, ReportBdoRecord> {
  if (!g.__ARIA_REPORT_BDO__) g.__ARIA_REPORT_BDO__ = new Map();
  return g.__ARIA_REPORT_BDO__;
}

function toRow(r: ReportBdoRecord): typeof report_bdo.$inferInsert {
  return { ...r, updated_at: new Date() };
}

async function upsertOne(r: ReportBdoRecord): Promise<void> {
  if (hasDB) {
    await getDb()
      .insert(report_bdo)
      .values(toRow(r))
      .onConflictDoUpdate({ target: report_bdo.num_bdo, set: toRow(r) });
    return;
  }
  mem().set(r.num_bdo, r);
}

// Persist rows from a "REPORT Bdo" upload, but only for BDO already present
// in the portfolio (interventi.bdo) — this table never creates new
// interventi, it only enriches ones that already exist. `Numero BDO` is the
// business key: matching rows are upserted (insert if new, update if
// already saved), everything else is reported as ignored.
export async function persistReportBdoFromUpload(
  rows: ReportBdoRecord[],
  knownBdo: Set<string>,
): Promise<{ saved: number; ignored: number }> {
  if (hasDB) await ensureSchema();
  let saved = 0;
  let ignored = 0;
  for (const r of rows) {
    if (!knownBdo.has(r.num_bdo)) {
      ignored += 1;
      continue;
    }
    await upsertOne(r);
    saved += 1;
  }
  return { saved, ignored };
}

// Every BDO row (full-database export). DB-backed with in-memory fallback.
export async function listAllReportBdo(): Promise<ReportBdoRecord[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(report_bdo);
    return rows.map(({ id: _id, updated_at: _u, ...rest }) => rest as ReportBdoRecord);
  }
  return [...mem().values()].map((r) => ({ ...r }));
}
