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
    numero_linea_ordine: r.numero_linea_ordine,
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

// Ciclo di vita di una riga BEF (fonte: business owner). "Fatturabile",
// "in attesa" ed "emessa" sono mutuamente esclusivi ed esaustivi; "incassata"
// non è un quarto stato a sé ma un SOTTOINSIEME di "emessa" (una fattura
// emessa è incassata o meno) — allineato al significato che il report BEF
// del business owner dà a "Fatturato emesso": il totale fatturato a oggi,
// incassato o meno, non solo la quota ancora da incassare. cfr. `isFatturata`
// sotto, già usata con lo stesso significato per il fatturato mensile.
//
//   num_fattura  data_fattura  data_pagamento  stato
//   ───────────  ────────────  ──────────────  ──────────────────────────────
//        no           no             —         da emettere      (fatturabile)
//        sì           no             —         emessa, non ancora approvata
//                                              dal cliente      (in attesa)
//        sì           sì             no/sì     emessa                (emesso)
//        sì           sì             sì          └─ di cui incassata (incassato)
//
// Lo stato "in attesa" è raro: di norma numero e data fattura sono entrambi
// presenti o entrambi assenti. Una riga senza numero fattura resta fra le
// fatturabili anche se porta una data: non può essere una fattura emessa.
const isDaEmettere = (r: BefRow) => !r.num_fattura;
const isInAttesa = (r: BefRow) => Boolean(r.num_fattura) && !r.data_fattura;
const isIncassata = (r: BefRow) =>
  Boolean(r.num_fattura) && Boolean(r.data_fattura) && Boolean(r.data_pagamento);

// Righe la cui fattura è stata emessa (numero E data fattura), incassata o
// meno: è il fatturato del mese, collocato nel mese di `data_fattura`.
const isFatturata = (r: BefRow) => Boolean(r.num_fattura) && Boolean(r.data_fattura);

// Sum of `importo_ricezione` grouped by calendar month of `data_fattura`, for
// rows già fatturate. Le righe ancora da emettere (e quelle in attesa, prive
// di data fattura) non hanno una data su cui collocarle e non compaiono nella
// serie mensile.
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

// Portfolio-level BEF totals (no year/period filtering), uno per stato della
// riga (vedi i predicati sopra):
//  - fatturabile:        fattura ancora da emettere
//  - fatturatoInAttesa:  emessa, in attesa di approvazione dal cliente
//  - fatturatoEmesso:    emessa (incassata o meno) — totale fatturato a oggi
//  - fatturatoIncassato: SOTTOINSIEME di fatturatoEmesso, di cui già incassata
// fatturabile + fatturatoInAttesa + fatturatoEmesso == totale BEF; fatturatoIncassato
// non va sommato di nuovo (è già incluso in fatturatoEmesso).
export function computeBefAggregates(rows: BefRow[]): BefAggregates {
  let fatturabile = 0,
    fatturatoInAttesa = 0,
    fatturatoEmesso = 0,
    fatturatoIncassato = 0;
  for (const r of rows) {
    if (r.importo_ricezione == null) continue;
    if (isDaEmettere(r)) fatturabile += r.importo_ricezione;
    else if (isInAttesa(r)) fatturatoInAttesa += r.importo_ricezione;
    else if (isFatturata(r)) {
      fatturatoEmesso += r.importo_ricezione;
      if (isIncassata(r)) fatturatoIncassato += r.importo_ricezione;
    }
  }
  return { fatturabile, fatturatoInAttesa, fatturatoEmesso, fatturatoIncassato };
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
    numero_linea_ordine: strN(r.numero_linea_ordine),
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

    // Sostituzione integrale delle righe di questo numero_if: `rows` è già
    // l'elenco completo per l'IF (lo snapshot del report, o la lista salvata
    // dall'editor admin), quindi non serve — e non è corretto — deduplicare
    // lato DB su una chiave che il report non garantisce univoca.
    const toInsertRow = (r: (typeof clean)[number]) => ({
      numero_if: r.numero_if,
      num_bdo: r.num_bdo,
      descrizione: r.descrizione,
      numero_linea_ordine: r.numero_linea_ordine,
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

// Numero IF di default per le righe BEF il cui BDO non trova corrispondenza
// in `interventi` (nessuna riga viene scartata: resta disponibile per un
// successivo aggancio manuale una volta censito l'intervento).
const UNRESOLVED_IF = '';

// Persiste le righe BEF di un upload risolvendo il numero IF dal BDO
// (BEF.num_bdo -> intervento.bdo). Ogni BEF porta sempre il suo BDO; come
// fallback estrae il BDO dal codice BEF a 20 cifre (posizioni 5-14).
//
// Il report BEF è uno SNAPSHOT completo: per ogni IF presente nell'upload le
// righe caricate sono la verità corrente e sostituiscono integralmente quelle
// già salvate (`replaceBef`). Gli IF non citati dall'upload restano intatti,
// quindi anche un report parziale è sicuro.
//
// Non c'è più alcuna fusione riga-per-riga con quanto già in archivio. Quella
// deduplicava su una chiave naturale che il report non garantisce, e sbagliava
// in entrambe le direzioni:
//  - la chiave conteneva `num_fattura`, che è MUTABILE: una riga che cambia
//    stato fra due upload (la fattura viene emessa nel frattempo) cambia
//    chiave e sopravvive ACCANTO alla propria versione aggiornata,
//    raddoppiando il suo importo ad ogni reimport;
//  - ogni colonna dimenticata nella chiave faceva collidere righe distinte,
//    che si sovrascrivevano a vicenda perdendo un importo — è così che sono
//    andate perse prima le righe con la stessa fattura, poi (fino
//    all'aggiunta di `numero_linea_ordine`) le linee d'ordine dello stesso
//    BDO/periodo.
// Sostituendo per intero, la somma degli importi salvati coincide sempre con
// la colonna "Importo Ricezione" del report, senza dipendere da quali colonne
// il report espone.
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
    await replaceBef(numeroIf, list);
    saved += list.length;
  }
  return { saved, ifs: [...byIf.keys()].filter((k) => k !== UNRESOLVED_IF), unresolved };
}
