import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema, excludedSet } from './db';
import { bef_records } from './schema';
import type { BefRow, BefRecord, BefMonthly, BefAggregates } from './types';
import { bdoFromBef } from './codes';

// Batch items for replaceBef: a mix of PgDelete and PgInsert query builders,
// all runnable against the 'pg' dialect (what db.batch() requires).
type BefBatchItem = RunnableQuery<unknown, 'pg'>;

// Per-IF/BO BEF rows. DB-backed with an in-memory fallback.
const g = globalThis as unknown as { __ARIA_BEF__?: Record<string, BefRow[]> };
function mem(): Record<string, BefRow[]> {
  if (!g.__ARIA_BEF__) g.__ARIA_BEF__ = {};
  return g.__ARIA_BEF__;
}

const numN = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const strN = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

type Row = typeof bef_records.$inferSelect;
function rowTo(r: Row): BefRow {
  return {
    id: r.id,
    numero_if: r.numero_if ?? '',
    num_bdo: r.num_bdo,
    descrizione: r.descrizione,
    periodo_competenza: r.periodo_competenza,
    fornitore_reale: r.fornitore_reale,
    importo_ricezione: r.importo_ricezione == null ? null : Number(r.importo_ricezione),
    num_fattura: r.num_fattura,
    data_fattura: r.data_fattura,
    data_pagamento: r.data_pagamento,
  };
}

export async function listBef(numeroIf: string): Promise<BefRow[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(bef_records).where(eq(bef_records.numero_if, numeroIf));
    return rows.map(rowTo);
  }
  return (mem()[numeroIf] || []).map((r) => ({ ...r }));
}

// All BEF rows across every IF/BO (used for portfolio-level aggregation).
export async function listAllBef(): Promise<BefRow[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(bef_records);
    return rows.map(rowTo);
  }
  return Object.values(mem()).flat().map((r) => ({ ...r }));
}

const isFatturata = (r: BefRow) => Boolean(r.num_fattura) && Boolean(r.data_fattura);
const isNonFatturata = (r: BefRow) => !r.num_fattura && !r.data_fattura;

// Sum of `importo_ricezione` grouped by calendar month of `data_fattura`, for
// rows that have both a `num_fattura` and a `data_fattura` (i.e. fatturate).
// The compute* variants are pure so callers that already hold the rows (e.g.
// getDashboardData) can derive both aggregates from a single fetch.
export function computeBefMonthlyTotals(rows: BefRow[]): BefMonthly[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!isFatturata(r) || r.importo_ricezione == null) continue;
    const [y, m] = (r.data_fattura as string).split('-');
    const anno = Number(y),
      mese = Number(m);
    if (!anno || !mese) continue;
    const key = `${anno}-${mese}`;
    totals.set(key, (totals.get(key) ?? 0) + r.importo_ricezione);
  }
  return [...totals.entries()].map(([key, totale]) => {
    const [anno, mese] = key.split('-').map(Number);
    return { anno, mese, totale };
  });
}

export async function getBefMonthlyTotals(): Promise<BefMonthly[]> {
  return computeBefMonthlyTotals(await listAllBef());
}

// Portfolio-level BEF totals (no year/period filtering):
//  - fatturabile: righe senza numero fattura e senza data fattura (non ancora fatturate)
//  - fatturatoEmesso: righe con numero fattura e data fattura (fatturate)
export function computeBefAggregates(rows: BefRow[]): BefAggregates {
  let fatturabile = 0,
    fatturatoEmesso = 0;
  for (const r of rows) {
    if (r.importo_ricezione == null) continue;
    if (isNonFatturata(r)) fatturabile += r.importo_ricezione;
    else if (isFatturata(r)) fatturatoEmesso += r.importo_ricezione;
  }
  return { fatturabile, fatturatoEmesso };
}

export async function getBefAggregates(): Promise<BefAggregates> {
  return computeBefAggregates(await listAllBef());
}

// Replace the full set of BEF rows for an intervento (idempotent save).
export async function replaceBef(numeroIf: string, rows: BefRow[]): Promise<BefRow[]> {
  const clean = rows.map((r) => ({
    numero_if: numeroIf,
    num_bdo: strN(r.num_bdo),
    descrizione: strN(r.descrizione),
    periodo_competenza: strN(r.periodo_competenza),
    fornitore_reale: strN(r.fornitore_reale),
    importo_ricezione: numN(r.importo_ricezione),
    num_fattura: strN(r.num_fattura),
    data_fattura: strN(r.data_fattura),
    data_pagamento: strN(r.data_pagamento),
  }));

  if (hasDB) {
    await ensureSchema();
    const db = getDb();

    // Natural key (numero_if, num_fattura) — see the unique index on
    // bef_records in lib/schema.ts. Rows without num_fattura aren't
    // deduplicable (pre-existing "Decisione 2B" rule in upsertBef below), so
    // they're bucketed separately and always fully replaced for this
    // numero_if instead of being matched by key.
    const keyed = clean.filter((r) => r.num_fattura != null);
    const unkeyed = clean.filter((r) => r.num_fattura == null);
    const keyedInvoices = keyed.map((r) => r.num_fattura as string);

    const toInsertRow = (r: (typeof clean)[number]) => ({
      numero_if: r.numero_if,
      num_bdo: r.num_bdo,
      descrizione: r.descrizione,
      periodo_competenza: r.periodo_competenza,
      fornitore_reale: r.fornitore_reale,
      importo_ricezione: r.importo_ricezione == null ? null : String(r.importo_ricezione),
      num_fattura: r.num_fattura,
      data_fattura: r.data_fattura,
      data_pagamento: r.data_pagamento,
    });

    // Drop invoiced rows whose invoice number is no longer in the new set
    // (removed from this IF's BEF list); unkeyed rows have no stable
    // identity, so this call's list is always their full replacement.
    const dropStaleKeyed = db
      .delete(bef_records)
      .where(
        keyedInvoices.length
          ? and(
              eq(bef_records.numero_if, numeroIf),
              isNotNull(bef_records.num_fattura),
              notInArray(bef_records.num_fattura, keyedInvoices),
            )
          : and(eq(bef_records.numero_if, numeroIf), isNotNull(bef_records.num_fattura)),
      );
    const dropUnkeyed = db
      .delete(bef_records)
      .where(and(eq(bef_records.numero_if, numeroIf), isNull(bef_records.num_fattura)));

    const statements: BefBatchItem[] = [dropStaleKeyed, dropUnkeyed];
    if (unkeyed.length) {
      statements.push(db.insert(bef_records).values(unkeyed.map(toInsertRow)));
    }
    if (keyed.length) {
      statements.push(
        db
          .insert(bef_records)
          .values(keyed.map(toInsertRow))
          .onConflictDoUpdate({
            target: [bef_records.numero_if, bef_records.num_fattura],
            set: excludedSet(bef_records, ['id', 'numero_if', 'num_fattura']),
          }),
      );
    }
    // db.batch() sends every statement to Neon's transactional batch
    // endpoint in a single HTTP round-trip: either all apply or none do.
    // neon-http has no interactive db.transaction() (see
    // drizzle-orm/neon-http/session.js), but batch() is backed by a real
    // Postgres transaction server-side.
    await db.batch(statements as [BefBatchItem, ...BefBatchItem[]]);
    return listBef(numeroIf);
  }
  mem()[numeroIf] = clean.map((r, i) => ({ id: i + 1, ...r }));
  return mem()[numeroIf].map((r) => ({ ...r }));
}

// Upsert per Numero Fattura (Decisione 2B): le righe in arrivo con la stessa
// fattura sostituiscono quelle esistenti, le nuove si aggiungono, le altre si
// conservano. Le righe senza Numero Fattura non sono deduplicabili e vengono
// accodate.
export async function upsertBef(numeroIf: string, incoming: BefRow[]): Promise<BefRow[]> {
  const existing = await listBef(numeroIf);
  const byFattura = new Map<string, BefRow>();
  const noKey: BefRow[] = [];
  const place = (r: BefRow) => {
    const k = strN(r.num_fattura);
    if (k) byFattura.set(k, { ...r, numero_if: numeroIf });
    else noKey.push({ ...r, numero_if: numeroIf });
  };
  existing.forEach(place);
  incoming.forEach(place);
  return replaceBef(numeroIf, [...byFattura.values(), ...noKey]);
}

// Numero IF di default per le righe BEF il cui BDO non trova corrispondenza
// in `interventi` (nessuna riga viene scartata: resta disponibile per un
// successivo aggancio manuale una volta censito l'intervento).
const UNRESOLVED_IF = '';

// Persiste le righe BEF di un upload risolvendo il numero IF dal BDO
// (BEF.num_bdo -> intervento.bdo). Ogni BEF porta sempre il suo BDO; come
// fallback estrae il BDO dal codice BEF a 20 cifre (posizioni 5-14).
export async function persistBefFromUpload(
  rows: BefRecord[],
  bdoToIf: Map<string, string>,
): Promise<{ saved: number; ifs: string[]; unresolved: number }> {
  const byIf = new Map<string, BefRow[]>();
  let unresolved = 0;
  for (const r of rows) {
    const bdo = strN(r.num_bdo) ?? bdoFromBef(r.num_fattura);
    const numeroIf = (bdo ? bdoToIf.get(bdo) : undefined) ?? UNRESOLVED_IF;
    if (numeroIf === UNRESOLVED_IF) unresolved += 1;
    const list = byIf.get(numeroIf) ?? [];
    list.push({ numero_if: numeroIf, ...r });
    byIf.set(numeroIf, list);
  }
  let saved = 0;
  for (const [numeroIf, list] of byIf) {
    await upsertBef(numeroIf, list);
    saved += list.length;
  }
  return { saved, ifs: [...byIf.keys()].filter((k) => k !== UNRESOLVED_IF), unresolved };
}
