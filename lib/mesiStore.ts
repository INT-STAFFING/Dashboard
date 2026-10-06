import { and, eq, inArray, or } from 'drizzle-orm';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import { getDb, hasDB, ensureSchema } from './db';
import { intervento_mesi } from './schema';
import { SEED_MESI } from './seed';
import type { Intervento, MonthFact } from './types';

// Monthly revenue and consuntivazione of each intervento, per calendar year.
// One logical record per (numero_if, anno, mese), stored sparsely (a month with
// both values at 0 simply has no row). DB-backed (table intervento_mesi) with an
// in-memory fallback seeded from the baseline portfolio. This is what replaced
// the single-year rev_mesi / cons_mesi arrays on `interventi`.

type BatchItem = RunnableQuery<unknown, 'pg'>;

export type MonthArrays = { rev: number[]; cons: number[] };

// Years the app accepts (same bounds the admin UI has always enforced).
export const ANNO_MIN = 2000;
export const ANNO_MAX = 2100;

export function isValidAnno(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= ANNO_MIN && v <= ANNO_MAX;
}

// Query-string / JSON friendly: "2026" and 2026 are both fine, anything else is null.
export function parseAnno(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isValidAnno(n) ? n : null;
}

const zero12 = (): number[] => Array(12).fill(0) as number[];
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const sum = (a: number[]): number => round4(a.reduce((s, v) => s + v, 0));
// Σ of a monthly profile, rounded to the 4 decimals the database keeps.
export const sum12 = sum;

export function v12(a: unknown): number[] {
  const out = zero12();
  if (Array.isArray(a)) for (let i = 0; i < 12; i++) out[i] = finite(Number(a[i]));
  return out;
}

// Which year to show when the caller doesn't ask for one: the current calendar
// year if it has data; otherwise the closest earlier year with data; otherwise
// the closest later one; with no data at all, the current year.
export function pickDefaultAnno(anni: number[], now: Date = new Date()): number {
  const current = now.getFullYear();
  if (!anni.length || anni.includes(current)) return current;
  const sorted = [...anni].sort((a, b) => a - b);
  const past = sorted.filter((y) => y < current);
  return past.length ? past[past.length - 1] : sorted[0];
}

// ---------------------------------------------------------------------------
// Pure helpers (shared by the store, the dashboard payload and the tests)
// ---------------------------------------------------------------------------
export function yearsOf(facts: MonthFact[]): number[] {
  return [...new Set(facts.map((f) => f.anno))].sort((a, b) => a - b);
}

// Facts of one year -> per-IF 12-month arrays.
export function factsToMap(facts: MonthFact[], anno: number): Map<string, MonthArrays> {
  const out = new Map<string, MonthArrays>();
  for (const f of facts) {
    if (f.anno !== anno || f.mese < 1 || f.mese > 12) continue;
    let a = out.get(f.numero_if);
    if (!a) out.set(f.numero_if, (a = { rev: zero12(), cons: zero12() }));
    a.rev[f.mese - 1] += finite(f.revenue);
    a.cons[f.mese - 1] += finite(f.consuntivo);
  }
  return out;
}

// Stamp the monthly profiles of one year onto interventi (which carry none of
// their own). IFs without facts for that year get zeros.
export function overlayMesi(base: Intervento[], byIf: Map<string, MonthArrays>): Intervento[] {
  return base.map((i) => {
    const m = byIf.get(i.numero_if);
    const rev = m ? m.rev.slice() : zero12();
    const cons = m ? m.cons.slice() : zero12();
    return { ...i, rev_mesi: rev, cons_mesi: cons, revenue_anno: sum(rev) };
  });
}

// 12 + 12 values of one IF and year -> sparse facts.
export function profileFacts(numeroIf: string, anno: number, rev: unknown, cons: unknown): MonthFact[] {
  const r = v12(rev);
  const c = v12(cons);
  const out: MonthFact[] = [];
  for (let m = 0; m < 12; m++) {
    if (r[m] !== 0 || c[m] !== 0) out.push({ numero_if: numeroIf, anno, mese: m + 1, revenue: r[m], consuntivo: c[m] });
  }
  return out;
}

// Untrusted payload (JSON of an upload) -> well-formed facts; anything else is dropped.
export function normalizeFacts(raw: unknown): MonthFact[] {
  if (!Array.isArray(raw)) return [];
  const out: MonthFact[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const numero_if = typeof o.numero_if === 'string' ? o.numero_if.trim() : typeof o.numero_if === 'number' ? String(o.numero_if) : '';
    const anno = parseAnno(o.anno);
    const mese = typeof o.mese === 'number' ? o.mese : Number(o.mese);
    if (!numero_if || anno == null || !Number.isInteger(mese) || mese < 1 || mese > 12) continue;
    const revenue = finite(typeof o.revenue === 'number' ? o.revenue : Number(o.revenue));
    const consuntivo = finite(typeof o.consuntivo === 'number' ? o.consuntivo : Number(o.consuntivo));
    out.push({ numero_if, anno, mese, revenue, consuntivo });
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-memory fallback (no DATABASE_URL), seeded from the baseline portfolio
// ---------------------------------------------------------------------------
type MemMesi = Map<string, Map<number, MonthArrays>>;
const g = globalThis as unknown as { __ARIA_MESI__?: MemMesi };

function mem(): MemMesi {
  if (!g.__ARIA_MESI__) {
    const m: MemMesi = new Map();
    for (const f of SEED_MESI) {
      const years = m.get(f.numero_if) ?? new Map<number, MonthArrays>();
      const a = years.get(f.anno) ?? { rev: zero12(), cons: zero12() };
      a.rev[f.mese - 1] = f.revenue;
      a.cons[f.mese - 1] = f.consuntivo;
      years.set(f.anno, a);
      m.set(f.numero_if, years);
    }
    g.__ARIA_MESI__ = m;
  }
  return g.__ARIA_MESI__;
}

function memSet(numeroIf: string, anno: number, rev: number[], cons: number[]): void {
  const years = mem().get(numeroIf) ?? new Map<number, MonthArrays>();
  if (rev.every((v) => v === 0) && cons.every((v) => v === 0)) years.delete(anno);
  else years.set(anno, { rev: rev.slice(), cons: cons.slice() });
  if (years.size) mem().set(numeroIf, years);
  else mem().delete(numeroIf);
}

function memFacts(): MonthFact[] {
  const out: MonthFact[] = [];
  for (const [numero_if, years] of mem()) {
    for (const [anno, a] of years) {
      for (let m = 0; m < 12; m++) {
        if (a.rev[m] !== 0 || a.cons[m] !== 0) out.push({ numero_if, anno, mese: m + 1, revenue: a.rev[m], consuntivo: a.cons[m] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
type Row = typeof intervento_mesi.$inferSelect;
const rowToFact = (r: Row): MonthFact => ({
  numero_if: r.numero_if,
  anno: r.anno,
  mese: r.mese,
  revenue: Number(r.revenue) || 0,
  consuntivo: Number(r.consuntivo) || 0,
});

// Every month of every year (the dashboard builds its multi-year timeline from this).
export async function listFacts(): Promise<MonthFact[]> {
  if (hasDB) {
    await ensureSchema();
    return (await getDb().select().from(intervento_mesi)).map(rowToFact);
  }
  return memFacts();
}

export async function listAnni(): Promise<number[]> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().selectDistinct({ anno: intervento_mesi.anno }).from(intervento_mesi);
    return rows.map((r) => r.anno).sort((a, b) => a - b);
  }
  return yearsOf(memFacts());
}

// A valid requested year wins; anything else falls back to the default.
export async function resolveAnno(requested?: unknown): Promise<number> {
  const asked = parseAnno(requested);
  if (asked != null) return asked;
  return pickDefaultAnno(await listAnni());
}

export async function listMesiByAnno(anno: number): Promise<Map<string, MonthArrays>> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb().select().from(intervento_mesi).where(eq(intervento_mesi.anno, anno));
    return factsToMap(rows.map(rowToFact), anno);
  }
  return factsToMap(memFacts(), anno);
}

export async function getIfMesi(numeroIf: string, anno: number): Promise<MonthArrays> {
  if (hasDB) {
    await ensureSchema();
    const rows = await getDb()
      .select()
      .from(intervento_mesi)
      .where(and(eq(intervento_mesi.numero_if, numeroIf), eq(intervento_mesi.anno, anno)));
    return factsToMap(rows.map(rowToFact), anno).get(numeroIf) ?? { rev: zero12(), cons: zero12() };
  }
  const a = mem().get(numeroIf)?.get(anno);
  return a ? { rev: a.rev.slice(), cons: a.cons.slice() } : { rev: zero12(), cons: zero12() };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
type InsertRow = typeof intervento_mesi.$inferInsert;

function insertRows(numeroIf: string, anno: number, rev: number[], cons: number[]): InsertRow[] {
  const rows: InsertRow[] = [];
  for (let m = 0; m < 12; m++) {
    if (rev[m] === 0 && cons[m] === 0) continue;
    rows.push({ numero_if: numeroIf, anno, mese: m + 1, revenue: String(rev[m]), consuntivo: String(cons[m]) });
  }
  return rows;
}

// The statements that replace one (IF, year) with the given 12 + 12 values, for
// callers that want them inside their own db.batch() (one transaction).
export function replaceStatements(
  db: ReturnType<typeof getDb>,
  numeroIf: string,
  anno: number,
  rev: number[],
  cons: number[],
): BatchItem[] {
  const stmts: BatchItem[] = [
    db.delete(intervento_mesi).where(and(eq(intervento_mesi.numero_if, numeroIf), eq(intervento_mesi.anno, anno))),
  ];
  const rows = insertRows(numeroIf, anno, v12(rev), v12(cons));
  if (rows.length) stmts.push(db.insert(intervento_mesi).values(rows));
  return stmts;
}

// Replace the whole 12-month profile of one IF in one year (the manual-edit path).
export async function setIfYear(numeroIf: string, anno: number, rev: number[], cons: number[]): Promise<void> {
  const r = v12(rev);
  const c = v12(cons);
  if (hasDB) {
    await ensureSchema();
    const db = getDb();
    await db.batch(replaceStatements(db, numeroIf, anno, r, c) as [BatchItem, ...BatchItem[]]);
    return;
  }
  memSet(numeroIf, anno, r, c);
}

const CHUNK_PAIRS = 300;
const CHUNK_ROWS = 1000;

// Merge the months of an upload into the store.
//
// An upload file only knows part of the picture (the Dashboard workbook carries
// revenue, not consuntivazione), so for every (IF, year) it mentions:
//  - revenue is replaced as a whole when the file has any non-zero revenue for
//    that IF and year, and left alone otherwise;
//  - consuntivazione likewise (it is normally managed from the admin page);
//  - years and IFs the file doesn't mention are never touched.
// IFs in `skipIfs` (manually edited records the upload must not overwrite) are
// ignored. Facts with an invalid year/month, or non-finite numbers, are dropped;
// repeated (IF, year, month) facts are summed. Atomic: one batch.
export async function persistMesiFromUpload(
  facts: MonthFact[],
  skipIfs: ReadonlySet<string> = new Set(),
): Promise<{ groups: number; rows: number }> {
  type Group = { numero_if: string; anno: number; rev: number[]; cons: number[] };
  const groups = new Map<string, Group>();
  for (const f of facts) {
    if (!f || typeof f.numero_if !== 'string' || !f.numero_if || skipIfs.has(f.numero_if)) continue;
    if (!isValidAnno(f.anno) || !Number.isInteger(f.mese) || f.mese < 1 || f.mese > 12) continue;
    const key = `${f.numero_if}\u0000${f.anno}`;
    let gr = groups.get(key);
    if (!gr) groups.set(key, (gr = { numero_if: f.numero_if, anno: f.anno, rev: zero12(), cons: zero12() }));
    gr.rev[f.mese - 1] += finite(f.revenue);
    gr.cons[f.mese - 1] += finite(f.consuntivo);
  }
  const incoming = [...groups.values()].filter((gr) => gr.rev.some((v) => v !== 0) || gr.cons.some((v) => v !== 0));
  if (!incoming.length) return { groups: 0, rows: 0 };

  // What is stored today for those (IF, year) pairs.
  const existing = new Map<string, MonthArrays>();
  if (hasDB) {
    await ensureSchema();
    const db = getDb();
    const annos = [...new Set(incoming.map((gr) => gr.anno))];
    const ifs = [...new Set(incoming.map((gr) => gr.numero_if))];
    for (let i = 0; i < ifs.length; i += CHUNK_ROWS) {
      const rows = await db
        .select()
        .from(intervento_mesi)
        .where(and(inArray(intervento_mesi.anno, annos), inArray(intervento_mesi.numero_if, ifs.slice(i, i + CHUNK_ROWS))));
      for (const r of rows) {
        const key = `${r.numero_if}\u0000${r.anno}`;
        let a = existing.get(key);
        if (!a) existing.set(key, (a = { rev: zero12(), cons: zero12() }));
        a.rev[r.mese - 1] = Number(r.revenue) || 0;
        a.cons[r.mese - 1] = Number(r.consuntivo) || 0;
      }
    }
  } else {
    for (const gr of incoming) {
      const a = mem().get(gr.numero_if)?.get(gr.anno);
      if (a) existing.set(`${gr.numero_if}\u0000${gr.anno}`, a);
    }
  }

  const merged = incoming.map((gr) => {
    const ex = existing.get(`${gr.numero_if}\u0000${gr.anno}`);
    return {
      numero_if: gr.numero_if,
      anno: gr.anno,
      rev: gr.rev.some((v) => v !== 0) ? gr.rev : ex ? ex.rev : zero12(),
      cons: gr.cons.some((v) => v !== 0) ? gr.cons : ex ? ex.cons : zero12(),
    };
  });

  if (!hasDB) {
    for (const m of merged) memSet(m.numero_if, m.anno, m.rev, m.cons);
    return { groups: merged.length, rows: merged.reduce((s, m) => s + insertRows(m.numero_if, m.anno, m.rev, m.cons).length, 0) };
  }

  const db = getDb();
  const stmts: BatchItem[] = [];
  for (let i = 0; i < merged.length; i += CHUNK_PAIRS) {
    const chunk = merged.slice(i, i + CHUNK_PAIRS);
    stmts.push(
      db.delete(intervento_mesi).where(or(...chunk.map((m) => and(eq(intervento_mesi.numero_if, m.numero_if), eq(intervento_mesi.anno, m.anno))))),
    );
  }
  const rows = merged.flatMap((m) => insertRows(m.numero_if, m.anno, m.rev, m.cons));
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    stmts.push(db.insert(intervento_mesi).values(rows.slice(i, i + CHUNK_ROWS)));
  }
  await db.batch(stmts as [BatchItem, ...BatchItem[]]);
  return { groups: merged.length, rows: rows.length };
}

// First-run seeding of a brand-new database with the baseline portfolio's months.
export async function seedMesi(): Promise<void> {
  if (!hasDB || !SEED_MESI.length) return;
  const db = getDb();
  const rows = SEED_MESI.map((f) => ({
    numero_if: f.numero_if,
    anno: f.anno,
    mese: f.mese,
    revenue: String(f.revenue),
    consuntivo: String(f.consuntivo),
  }));
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    await db.insert(intervento_mesi).values(rows.slice(i, i + CHUNK_ROWS)).onConflictDoNothing();
  }
}
