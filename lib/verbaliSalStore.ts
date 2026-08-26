import { createSnapshotStore } from './dualModeStore';
import { verbali_sal } from './schema';
import type { VerbaleSalRecord } from './types';

// Snapshot of the "REPORT Sal" export. Multiple rows per num_bdo are expected
// (periodic SAL over time), so every upload is a plain append — no upsert,
// no dedup (no `extraKeyColumns` below). DB-backed with an in-memory
// fallback. See lib/dualModeStore.ts for the shared implementation (R-5).
const store = createSnapshotStore<typeof verbali_sal, VerbaleSalRecord>({
  table: verbali_sal,
  memGlobalKey: '__ARIA_VERBALI_SAL__',
  scopeColumn: verbali_sal.num_bdo,
  getScopeValue: (r) => r.num_bdo,
});

export const persistVerbaliSalFromUpload = store.persistFromUpload;

// Monthly SAL rows for a single BDO (Dettaglio IF drill-down).
export const listSalByBdo = store.listByScope;

// Every verbale SAL (full-database export).
export const listAllVerbaliSal = store.listAll;
