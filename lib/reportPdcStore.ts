import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema, excludedSet } from './db';
import { report_pdc } from './schema';
import type { ReportPdcRecord } from './types';

// Snapshot of the "REPORT Pdc" export. Natural key (num_bdo, posizione_bdo,
// periodo_pdc) — see the unique index in lib/schema.ts. Rows missing
// posizione_bdo or periodo_pdc aren't deduplicable and are always fully
// replaced for their num_bdo instead of being matched by key.
// DB-backed with an in-memory fallback.
type PdcBatchItem = RunnableQuery<unknown, 'pg'>;
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

    const isKeyed = (r: ReportPdcRecord) =>
      r.posizione_bdo != null && r.posizione_bdo !== '' && r.periodo_pdc != null && r.periodo_pdc !== '';
    const keyed = kept.filter(isKeyed);
    const unkeyed = kept.filter((r) => !isKeyed(r));

    // Drop keyed rows whose (num_bdo, posizione_bdo, periodo_pdc) triple is
    // no longer in the new set for that BDO — removed/superseded in this
    // upload. Postgres row-value IN is used since Drizzle has no typed
    // "tuple not in" helper.
    const keyedTriples = keyed.map((r) => sql`(${r.num_bdo}, ${r.posizione_bdo}, ${r.periodo_pdc})`);
    const dropStaleKeyed = db
      .delete(report_pdc)
      .where(
        keyedTriples.length
          ? and(
              inArray(report_pdc.num_bdo, bdoList),
              isNotNull(report_pdc.posizione_bdo),
              isNotNull(report_pdc.periodo_pdc),
              sql`(${report_pdc.num_bdo}, ${report_pdc.posizione_bdo}, ${report_pdc.periodo_pdc}) NOT IN (${sql.join(keyedTriples, sql`, `)})`,
            )
          : and(inArray(report_pdc.num_bdo, bdoList), isNotNull(report_pdc.posizione_bdo), isNotNull(report_pdc.periodo_pdc)),
      );
    // Unkeyed rows have no stable identity, so this upload's list is always
    // their full replacement for the BDOs it touches.
    const dropUnkeyed = db
      .delete(report_pdc)
      .where(and(inArray(report_pdc.num_bdo, bdoList), or(isNull(report_pdc.posizione_bdo), isNull(report_pdc.periodo_pdc))));

    const statements: PdcBatchItem[] = [dropStaleKeyed, dropUnkeyed];
    if (unkeyed.length) statements.push(db.insert(report_pdc).values(unkeyed.map(toRow)));
    if (keyed.length) {
      statements.push(
        db
          .insert(report_pdc)
          .values(keyed.map(toRow))
          .onConflictDoUpdate({
            target: [report_pdc.num_bdo, report_pdc.posizione_bdo, report_pdc.periodo_pdc],
            set: excludedSet(report_pdc, ['id', 'num_bdo', 'posizione_bdo', 'periodo_pdc']),
          }),
      );
    }
    // db.batch() sends every statement to Neon's transactional batch
    // endpoint in a single HTTP round-trip: either all apply or none do.
    // neon-http has no interactive db.transaction() (see
    // drizzle-orm/neon-http/session.js).
    await db.batch(statements as [PdcBatchItem, ...PdcBatchItem[]]);
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
