import { eq, inArray } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { report_pdc } from './schema';
import type { ReportPdcRecord } from './types';

// Snapshot of the "REPORT Pdc" export. No natural UNIQUE key (num_bdo repeats
// once per posizione BDO x periodo di competenza), so re-running the same
// upload is made idempotent by deleting every row whose num_bdo appears in
// the incoming batch before re-inserting it (mirrors verbaliAperturaStore).
// DB-backed with an in-memory fallback.
const g = globalThis as unknown as { __ARIA_REPORT_PDC__?: ReportPdcRecord[] };
function mem(): ReportPdcRecord[] {
  if (!g.__ARIA_REPORT_PDC__) g.__ARIA_REPORT_PDC__ = [];
  return g.__ARIA_REPORT_PDC__;
}

function toRow(r: ReportPdcRecord): typeof report_pdc.$inferInsert {
  return {
    ...r,
    importo_posizione: r.importo_posizione == null ? null : String(r.importo_posizione),
    costo_subappalto: r.costo_subappalto == null ? null : String(r.costo_subappalto),
    updated_at: new Date(),
  };
}

// Persist rows from a "REPORT Pdc" upload, but only for BDO already present
// in the portfolio (interventi.bdo) — this table never creates new
// interventi, it only enriches ones that already exist (same restriction as
// REPORT Bdo).
export async function persistReportPdcFromUpload(
  rows: ReportPdcRecord[],
  knownBdo: Set<string>,
): Promise<{ saved: number; ignored: number }> {
  const kept = rows.filter((r) => knownBdo.has(r.num_bdo));
  const ignored = rows.length - kept.length;
  if (!kept.length) return { saved: 0, ignored };
  const bdoList = [...new Set(kept.map((r) => r.num_bdo))];

  if (hasDB) {
    await ensureSchema();
    const db = getDb();
    await db.delete(report_pdc).where(inArray(report_pdc.num_bdo, bdoList));
    await db.insert(report_pdc).values(kept.map(toRow));
    return { saved: kept.length, ignored };
  }

  const preserved = mem().filter((r) => !bdoList.includes(r.num_bdo));
  preserved.push(...kept);
  g.__ARIA_REPORT_PDC__ = preserved;
  return { saved: kept.length, ignored };
}

type Row = typeof report_pdc.$inferSelect;
function rowToRecord(r: Row): ReportPdcRecord {
  return {
    num_bdo: r.num_bdo ?? '',
    posizione_bdo: r.posizione_bdo,
    descrizione_posizione: r.descrizione_posizione,
    importo_posizione: r.importo_posizione == null ? null : Number(r.importo_posizione),
    codice_pdc: r.codice_pdc,
    periodo_pdc: r.periodo_pdc,
    data_creazione: r.data_creazione,
    utente_caricamento: r.utente_caricamento,
    codifica_documento: r.codifica_documento,
    stato_pdc: r.stato_pdc,
    divisione: r.divisione,
    centro_costo: r.centro_costo,
    fornitore_rti: r.fornitore_rti,
    roi: r.roi,
    data_invio_roi: r.data_invio_roi,
    data_rifiuto_roi: r.data_rifiuto_roi,
    data_approvazione_roi: r.data_approvazione_roi,
    fornitore_prestazione: r.fornitore_prestazione,
    service_line: r.service_line,
    tipo_fornitura: r.tipo_fornitura,
    rdi: r.rdi,
    posizione_rdi: r.posizione_rdi,
    subappalto: r.subappalto,
    subappaltatore: r.subappaltatore,
    costo_subappalto: r.costo_subappalto == null ? null : Number(r.costo_subappalto),
  };
}

// Monthly PDC rows for a single BDO (Dettaglio IF drill-down).
export async function listPdcByBdo(numBdo: string): Promise<ReportPdcRecord[]> {
  if (!numBdo) return [];
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(report_pdc).where(eq(report_pdc.num_bdo, numBdo));
    return rows.map(rowToRecord);
  }
  return mem().filter((r) => r.num_bdo === numBdo);
}
