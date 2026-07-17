import { createSnapshotStore } from './dualModeStore';
import { verbali_apertura } from './schema';
import type { VerbaleAperturaRecord } from './types';

// Snapshot of the "REPORT Apertura" export. Natural key (num_bdo,
// codifica_documento) — see the unique index in lib/schema.ts. Rows missing
// codifica_documento aren't deduplicable and are always fully replaced for
// their num_bdo instead of being matched by key. DB-backed with an in-memory
// fallback. See lib/dualModeStore.ts for the shared implementation (R-5).
const store = createSnapshotStore<typeof verbali_apertura, VerbaleAperturaRecord>({
  table: verbali_apertura,
  memGlobalKey: '__ARIA_VERBALI_APERTURA__',
  scopeColumn: verbali_apertura.num_bdo,
  getScopeValue: (r) => r.num_bdo,
  extraKeyColumns: [verbali_apertura.codifica_documento],
  getExtraKeyValues: (r) => [r.codifica_documento],
});

export const persistVerbaliAperturaFromUpload = store.persistFromUpload;
