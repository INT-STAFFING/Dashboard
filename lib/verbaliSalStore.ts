import { eq } from 'drizzle-orm';
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

type Row = typeof verbali_sal.$inferSelect;
function rowToRecord(r: Row): VerbaleSalRecord {
  return {
    num_bdo: r.num_bdo,
    descrizione: r.descrizione,
    nome_file: r.nome_file,
    codifica_documento: r.codifica_documento,
    stato_verbale: r.stato_verbale,
    periodo_competenza: r.periodo_competenza,
    conforme: r.conforme,
    motivo_conformita: r.motivo_conformita,
    criticita: r.criticita,
    motivazione_criticita: r.motivazione_criticita,
    livelli_servizio_rispettati: r.livelli_servizio_rispettati,
    divisione: r.divisione,
    centro_costo: r.centro_costo,
    fornitore: r.fornitore,
    utente_caricamento_fornitore: r.utente_caricamento_fornitore,
    data_firma_fornitore: r.data_firma_fornitore,
    roi: r.roi,
    data_inserimento_verbale_non_sottomesso: r.data_inserimento_verbale_non_sottomesso,
    data_sottomissione_verbale_fornitore: r.data_sottomissione_verbale_fornitore,
    data_firma_roi: r.data_firma_roi,
    data_rifiuto_roi: r.data_rifiuto_roi,
    data_invio_roi: r.data_invio_roi,
  };
}

// Monthly SAL rows for a single BDO (Dettaglio IF drill-down).
export async function listSalByBdo(numBdo: string): Promise<VerbaleSalRecord[]> {
  if (!numBdo) return [];
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(verbali_sal).where(eq(verbali_sal.num_bdo, numBdo));
    return rows.map(rowToRecord);
  }
  return mem().filter((r) => r.num_bdo === numBdo);
}
