import { eq } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema } from './db';
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

    // Sostituzione integrale delle righe di questo numero_if: `clean` è già
    // l'elenco completo e deduplicato per l'IF (vedi upsertBef, che fonde
    // esistenti e nuove prima di chiamare qui), quindi non serve — e non è
    // corretto — deduplicare di nuovo lato DB su una chiave parziale.
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

    const statements: BefBatchItem[] = [
      db.delete(bef_records).where(eq(bef_records.numero_if, numeroIf)),
    ];
    if (clean.length) {
      statements.push(db.insert(bef_records).values(clean.map(toInsertRow)));
    }
    // db.batch() sends every statement to Neon's transactional batch
    // endpoint in a single HTTP round-trip: either all apply or none do.
    // neon-http has no interactive db.transaction() (see
    // drizzle-orm/neon-http/session.js), but batch() is backed by a real
    // Postgres transaction server-side — la DELETE + INSERT resta quindi
    // atomica come nella versione precedente basata su ON CONFLICT.
    await db.batch(statements as [BefBatchItem, ...BefBatchItem[]]);
    return listBef(numeroIf);
  }
  mem()[numeroIf] = clean.map((r, i) => ({ id: i + 1, ...r }));
  return mem()[numeroIf].map((r) => ({ ...r }));
}

// Chiave naturale di una riga BEF all'interno di un IF.
//
// NON è il solo Numero Fattura: una fattura copre normalmente PIÙ righe BEF
// dello stesso intervento (una per BDO e per periodo di competenza), quindi
// deduplicare sul solo numero fattura le collassava in un'unica riga,
// perdendo l'importo di tutte le altre e sottostimando il "Fatturato emesso".
// La riga è identificata da BDO + periodo di competenza + fattura; le righe
// prive di tutti e tre non sono deduplicabili.
const befKey = (r: BefRow): string | null => {
  const parts = [strN(r.num_bdo), strN(r.periodo_competenza), strN(r.num_fattura)];
  return parts.some(Boolean) ? parts.map((p) => p ?? '').join('|') : null;
};

// Upsert per chiave naturale (Decisione 2B, corretta): le righe in arrivo con
// la stessa chiave sostituiscono quelle esistenti, le nuove si aggiungono, le
// altre si conservano. Le righe senza alcun elemento di chiave non sono
// deduplicabili e vengono accodate.
export async function upsertBef(numeroIf: string, incoming: BefRow[]): Promise<BefRow[]> {
  const existing = await listBef(numeroIf);
  const byKey = new Map<string, BefRow>();
  const noKey: BefRow[] = [];
  const place = (r: BefRow) => {
    const k = befKey(r);
    if (k) byKey.set(k, { ...r, numero_if: numeroIf });
    else noKey.push({ ...r, numero_if: numeroIf });
  };
  existing.forEach(place);
  incoming.forEach(place);
  return replaceBef(numeroIf, [...byKey.values(), ...noKey]);
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
