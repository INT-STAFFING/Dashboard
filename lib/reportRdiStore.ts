import { getDb, hasDB, ensureSchema } from './db';
import { report_rdi } from './schema';
import type { ReportRdiRecord } from './types';

// Snapshot of the "REPORT Rdi" export, one row per numero_rdi. DB-backed with
// an in-memory fallback (mirrors lib/reportBdoStore.ts).
const g = globalThis as unknown as { __ARIA_REPORT_RDI__?: Map<string, ReportRdiRecord> };
function mem(): Map<string, ReportRdiRecord> {
  if (!g.__ARIA_REPORT_RDI__) g.__ARIA_REPORT_RDI__ = new Map();
  return g.__ARIA_REPORT_RDI__;
}

function toRow(r: ReportRdiRecord): typeof report_rdi.$inferInsert {
  return { ...r, updated_at: new Date() };
}

async function upsertOne(r: ReportRdiRecord): Promise<void> {
  if (hasDB) {
    await getDb()
      .insert(report_rdi)
      .values(toRow(r))
      .onConflictDoUpdate({ target: report_rdi.numero_rdi, set: toRow(r) });
    return;
  }
  mem().set(r.numero_rdi, r);
}

// Persist rows from a "REPORT Rdi" upload. `Numero RDI` is the business key:
// matching rows are upserted (insert if new, update if already saved).
export async function persistReportRdiFromUpload(
  rows: ReportRdiRecord[],
): Promise<{ saved: number }> {
  if (hasDB) await ensureSchema();
  let saved = 0;
  for (const r of rows) {
    await upsertOne(r);
    saved += 1;
  }
  return { saved };
}

// Every RDI row (full-database export). DB-backed with in-memory fallback.
export async function listAllReportRdi(): Promise<ReportRdiRecord[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(report_rdi);
    return rows.map(({ id: _id, updated_at: _u, ...rest }) => rest as ReportRdiRecord);
  }
  return [...mem().values()].map((r) => ({ ...r }));
}
