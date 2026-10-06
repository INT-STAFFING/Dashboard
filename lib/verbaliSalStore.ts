import { createSnapshotStore } from './dualModeStore';
import { verbali_sal } from './schema';
import type { VerbaleSalRecord } from './types';

// Snapshot of the "REPORT Sal" export. Multiple rows per num_bdo are expected
// (periodic SAL over time), so uploads only ever append — rows of earlier
// uploads are never updated or deleted, and there is no natural key (no
// `extraKeyColumns` below). The append is idempotent: a row identical to one
// already stored for the same BDO is skipped, so re-uploading a file doesn't
// duplicate it (see `insertMissing` in lib/dualModeStore.ts). DB-backed with an
// in-memory fallback. See lib/dualModeStore.ts for the shared implementation (R-5).
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
