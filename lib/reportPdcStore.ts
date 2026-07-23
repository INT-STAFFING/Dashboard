import { createSnapshotStore } from './dualModeStore';
import { report_pdc } from './schema';
import type { ReportPdcRecord } from './types';

// Snapshot of the "REPORT Pdc" export. Natural key (num_bdo, posizione_bdo,
// periodo_pdc) — see the unique index in lib/schema.ts. Rows missing
// posizione_bdo or periodo_pdc aren't deduplicable and are always fully
// replaced for their num_bdo instead of being matched by key.
// DB-backed with an in-memory fallback. See lib/dualModeStore.ts for the
// shared implementation (R-5).
const store = createSnapshotStore<typeof report_pdc, ReportPdcRecord>({
  table: report_pdc,
  memGlobalKey: '__ARIA_REPORT_PDC__',
  scopeColumn: report_pdc.num_bdo,
  getScopeValue: (r) => r.num_bdo,
  extraKeyColumns: [report_pdc.posizione_bdo, report_pdc.periodo_pdc],
  getExtraKeyValues: (r) => [r.posizione_bdo, r.periodo_pdc],
  numericColumns: ['importo_posizione', 'costo_subappalto'],
});

// Persist rows from a "REPORT Pdc" upload, but only for BDO already present
// in the portfolio (interventi.bdo) — this table never creates new
// interventi, it only enriches ones that already exist (same restriction as
// REPORT Bdo). This filtering is specific to report_pdc's business rule, so
// it stays local rather than living in the shared snapshot-store factory.
export async function persistReportPdcFromUpload(
  rows: ReportPdcRecord[],
  knownBdo: Set<string>,
): Promise<{ saved: number; ignored: number }> {
  const kept = rows.filter((r) => knownBdo.has(r.num_bdo));
  const ignored = rows.length - kept.length;
  const { saved } = await store.persistFromUpload(kept);
  return { saved, ignored };
}

// Monthly PDC rows for a single BDO (Dettaglio IF drill-down).
export const listPdcByBdo = store.listByScope;

// Every PDC row (full-database export).
export const listAllPdc = store.listAll;
