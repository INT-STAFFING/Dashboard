import { eq, inArray, isNull } from 'drizzle-orm';
import { getDb, hasDB, ensureSchema } from './db';
import { interventi as interventiTable } from './schema';
import { SEED_INTERVENTI } from './seed';
import type { DocStatus, Intervento, InterventoInput } from './types';

// ---------------------------------------------------------------------------
// Doc-status mapping (domain <-> DB text)
// ---------------------------------------------------------------------------
const DOC_TO_DB: Record<DocStatus, string> = {
  ok: 'OK',
  ko: 'Mancante',
  prog: 'InCorso',
  nd: 'ND',
};
const DOC_FROM_DB: Record<string, DocStatus> = {
  OK: 'ok',
  Mancante: 'ko',
  InCorso: 'prog',
  ND: 'nd',
};
const docToDb = (s: DocStatus) => DOC_TO_DB[s] ?? 'ND';
const docFromDb = (s: string | null): DocStatus => (s ? DOC_FROM_DB[s] ?? 'nd' : 'nd');

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

type Row = typeof interventiTable.$inferSelect;

function rowToIntervento(r: Row): Intervento {
  return {
    numero_if: r.numero_if,
    bdo: r.bdo,
    titolo: r.titolo,
    ambito: r.ambito,
    fornitore: r.fornitore ?? '',
    ref_aria: r.ref_aria,
    ref_fornitore: r.ref_fornitore,
    importo: num(r.importo),
    revenue_2026: num(r.revenue_2026),
    rev_mesi: Array.isArray(r.rev_mesi) && r.rev_mesi.length === 12 ? r.rev_mesi : Array(12).fill(0),
    cons_mesi: Array.isArray(r.cons_mesi) && r.cons_mesi.length === 12 ? r.cons_mesi : Array(12).fill(0),
    modalita_if: r.modalita_if,
    attivazione: r.attivazione,
    stato: r.stato ?? 'non elaborato',
    has_bo: Boolean(r.has_bo),
    pdc: docFromDb(r.pdc),
    v_apertura: docFromDb(r.v_apertura),
    v_sal: docFromDb(r.v_sal),
    bef: docFromDb(r.bef_status),
    subappalto: Boolean(r.subappalto),
    subappaltatore: Array.isArray(r.subappaltatore) ? r.subappaltatore : [],
    costo_subappalto: num(r.costo_subappalto),
    data_assegnazione: r.data_assegnazione,
    data_inizio: r.data_inizio,
    data_fine: r.data_fine,
    azione: r.azione,
    note_operative: r.note_operative,
    edited_manually: Boolean(r.edited_manually),
    last_edited_at: r.last_edited_at ? new Date(r.last_edited_at).toISOString() : null,
    last_edited_by: r.last_edited_by,
  };
}

function interventoToRow(i: Intervento): typeof interventiTable.$inferInsert {
  return {
    numero_if: i.numero_if,
    bdo: i.bdo,
    titolo: i.titolo,
    ambito: i.ambito,
    fornitore: i.fornitore,
    ref_aria: i.ref_aria,
    ref_fornitore: i.ref_fornitore,
    importo: String(i.importo),
    revenue_2026: String(i.revenue_2026),
    rev_mesi: i.rev_mesi,
    cons_mesi: i.cons_mesi,
    modalita_if: i.modalita_if,
    attivazione: i.attivazione,
    stato: i.stato,
    has_bo: i.has_bo,
    pdc: docToDb(i.pdc),
    v_apertura: docToDb(i.v_apertura),
    v_sal: docToDb(i.v_sal),
    bef_status: docToDb(i.bef),
    subappalto: i.subappalto,
    subappaltatore: i.subappaltatore,
    costo_subappalto: String(i.costo_subappalto),
    data_assegnazione: i.data_assegnazione,
    data_inizio: i.data_inizio,
    data_fine: i.data_fine,
    azione: i.azione,
    note_operative: i.note_operative,
    edited_manually: i.edited_manually,
    last_edited_at: i.last_edited_at ? new Date(i.last_edited_at) : null,
    last_edited_by: i.last_edited_by,
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback store (used when no DB is configured)
// ---------------------------------------------------------------------------
type MemRecord = Intervento & { deleted_at: string | null };

const g = globalThis as unknown as { __ARIA_MEM__?: MemRecord[] };
function mem(): MemRecord[] {
  if (!g.__ARIA_MEM__) {
    g.__ARIA_MEM__ = SEED_INTERVENTI.map((i) => ({ ...i, deleted_at: null }));
  }
  return g.__ARIA_MEM__;
}

// Apply a partial input onto an existing intervento, returning a new object.
function applyInput(base: Intervento, input: InterventoInput): Intervento {
  return { ...base, ...input, numero_if: base.numero_if } as Intervento;
}

// Shared invariants enforced on every write path (drawer, inline edit, raw
// API/upload) — previously only checked client-side in EditDrawer, so they
// were silently bypassable via inline edits or direct API calls.
function validateIntervento(rec: Intervento): void {
  if (rec.importo != null && (!Number.isFinite(rec.importo) || rec.importo < 0)) {
    throw new Error('Importo non valido: deve essere un numero >= 0');
  }
  if (rec.data_inizio && rec.data_fine && rec.data_fine < rec.data_inizio) {
    throw new Error('La data di fine non può essere precedente alla data di inizio');
  }
}

// Keep `has_bo` and `stato` in lockstep (mirrors the convention already used
// by every Excel parser: has_bo <=> stato === 'approvato'). If a caller only
// touches one of the two fields (e.g. an inline edit that sets `stato` alone),
// derive the other so the pair never silently diverges. If both are supplied
// together in the same patch, the caller's explicit intent wins for both.
function syncStatoBo(input: InterventoInput, rec: Intervento): void {
  const hasStato = Object.prototype.hasOwnProperty.call(input, 'stato');
  const hasBo = Object.prototype.hasOwnProperty.call(input, 'has_bo');
  if (hasStato && !hasBo) {
    rec.has_bo = rec.stato === 'approvato';
  } else if (hasBo && !hasStato) {
    rec.stato = rec.has_bo ? 'approvato' : 'non elaborato';
  }
}

const DEFAULTS: Omit<Intervento, 'numero_if' | 'titolo'> = {
  bdo: null,
  ambito: null,
  fornitore: 'Intellera',
  ref_aria: null,
  ref_fornitore: null,
  importo: 0,
  revenue_2026: 0,
  rev_mesi: Array(12).fill(0),
  cons_mesi: Array(12).fill(0),
  modalita_if: null,
  attivazione: 'NO',
  stato: 'non elaborato',
  has_bo: false,
  pdc: 'nd',
  v_apertura: 'nd',
  v_sal: 'nd',
  bef: 'nd',
  subappalto: false,
  subappaltatore: [],
  costo_subappalto: 0,
  data_assegnazione: null,
  data_inizio: null,
  data_fine: null,
  azione: null,
  note_operative: null,
  edited_manually: false,
  last_edited_at: null,
  last_edited_by: null,
};

// On a fresh Neon database the tables are created on first access and the
// baseline portfolio is loaded once, so the dashboard is never empty after
// switching from the in-memory store to a persistent DB. Cached per instance.
let dbReadyPromise: Promise<void> | null = null;

async function ensureDbReady(): Promise<void> {
  if (!hasDB) return;
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await ensureSchema();
      const existing = await getDb().select({ id: interventiTable.id }).from(interventiTable).limit(1);
      if (existing.length === 0) {
        for (const i of SEED_INTERVENTI) {
          await getDb().insert(interventiTable).values(interventoToRow(i)).onConflictDoNothing();
        }
      }
    })().catch((e) => {
      dbReadyPromise = null; // allow retry on next call
      throw e;
    });
  }
  return dbReadyPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function listInterventi(): Promise<Intervento[]> {
  if (hasDB) {
    await ensureDbReady();
    const rows = await getDb()
      .select()
      .from(interventiTable)
      .where(isNull(interventiTable.deleted_at));
    return rows.map(rowToIntervento);
  }
  return mem()
    .filter((r) => !r.deleted_at)
    .map(({ deleted_at, ...rest }) => rest);
}

export async function getIntervento(numeroIf: string): Promise<Intervento | null> {
  if (hasDB) {
    const rows = await getDb()
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.numero_if, numeroIf));
    const r = rows[0];
    return r && !r.deleted_at ? rowToIntervento(r) : null;
  }
  const r = mem().find((x) => x.numero_if === numeroIf && !x.deleted_at);
  if (!r) return null;
  const { deleted_at, ...rest } = r;
  return rest;
}

export async function createIntervento(
  input: InterventoInput,
  by?: string,
): Promise<Intervento> {
  if (!input.numero_if) throw new Error('numero_if obbligatorio');
  if (!input.titolo) throw new Error('titolo obbligatorio');
  const nowIso = new Date().toISOString();
  const record: Intervento = {
    ...DEFAULTS,
    ...input,
    numero_if: input.numero_if,
    titolo: input.titolo,
    edited_manually: true,
    last_edited_at: nowIso,
    last_edited_by: by ?? 'ui',
  } as Intervento;
  validateIntervento(record);

  if (hasDB) {
    await getDb().insert(interventiTable).values(interventoToRow(record));
    return record;
  }
  const list = mem();
  if (list.some((x) => x.numero_if === record.numero_if && !x.deleted_at)) {
    throw new Error('Intervento già esistente');
  }
  list.unshift({ ...record, deleted_at: null });
  return record;
}

export async function updateIntervento(
  numeroIf: string,
  input: InterventoInput,
  by?: string,
): Promise<Intervento | null> {
  const existing = await getIntervento(numeroIf);
  if (!existing) return null;
  const nowIso = new Date().toISOString();
  const updated = applyInput(existing, input);
  updated.edited_manually = true;
  updated.last_edited_at = nowIso;
  updated.last_edited_by = by ?? 'ui';
  syncStatoBo(input, updated);
  validateIntervento(updated);

  if (hasDB) {
    await getDb()
      .update(interventiTable)
      .set({ ...interventoToRow(updated), updated_at: new Date() })
      .where(eq(interventiTable.numero_if, numeroIf));
    return updated;
  }
  const list = mem();
  const idx = list.findIndex((x) => x.numero_if === numeroIf && !x.deleted_at);
  if (idx < 0) return null;
  list[idx] = { ...updated, deleted_at: null };
  return updated;
}

export async function softDeleteIntervento(numeroIf: string): Promise<boolean> {
  if (hasDB) {
    const res = await getDb()
      .update(interventiTable)
      .set({ deleted_at: new Date() })
      .where(eq(interventiTable.numero_if, numeroIf))
      .returning({ id: interventiTable.id });
    return res.length > 0;
  }
  const r = mem().find((x) => x.numero_if === numeroIf && !x.deleted_at);
  if (!r) return false;
  r.deleted_at = new Date().toISOString();
  return true;
}

export type UploadResult = {
  inserted: number;
  updated: number;
  skipped: number;
  // Which IF/BO ended up in each bucket, so the upload UI can show *what* was
  // touched (and crucially, which manually-edited records were preserved).
  insertedIfs: string[];
  updatedIfs: string[];
  skippedIfs: string[];
};

// Different source files carry different slices of an intervento: IF_ARIA has
// ambito / referenti / BO / doc-status, the Dashboard workbook has importo /
// dates / monthly revenue, etc. When merging an upload onto an existing record
// we must not let a file blank out fields it simply doesn't know about, while
// still letting it update the fields it does carry. So for descriptive fields
// the incoming value wins only when it's actually present, and we never
// downgrade an emitted BO or recognized doc-status back to its default.
function mergeUpload(existing: Intervento, inc: Intervento, force: boolean): Intervento {
  const keep = <T>(v: T | null | undefined, fallback: T): T =>
    v == null || v === '' ? fallback : v;
  const incHasRevenue =
    inc.revenue_2026 > 0 || (Array.isArray(inc.rev_mesi) && inc.rev_mesi.some((v) => v > 0));
  const keepDoc = (a: DocStatus, b: DocStatus): DocStatus => (a !== 'nd' ? a : b);

  return {
    ...inc,
    bdo: keep(inc.bdo, existing.bdo),
    ambito: keep(inc.ambito, existing.ambito),
    ref_aria: keep(inc.ref_aria, existing.ref_aria),
    ref_fornitore: keep(inc.ref_fornitore, existing.ref_fornitore),
    modalita_if: keep(inc.modalita_if, existing.modalita_if),
    attivazione: inc.attivazione === 'SI' ? 'SI' : existing.attivazione,
    // Revenue lives only in the Dashboard workbook; don't let other files wipe it.
    revenue_2026: incHasRevenue ? inc.revenue_2026 : existing.revenue_2026,
    rev_mesi: incHasRevenue ? inc.rev_mesi : existing.rev_mesi,
    // Consuntivazione is managed from the admin page, not the Excel uploads.
    cons_mesi:
      Array.isArray(inc.cons_mesi) && inc.cons_mesi.some((v) => v > 0)
        ? inc.cons_mesi
        : existing.cons_mesi,
    // Never clear an already-emitted BO just because this source lacks it.
    has_bo: inc.has_bo || existing.has_bo,
    stato: inc.has_bo ? inc.stato : existing.stato,
    pdc: keepDoc(inc.pdc, existing.pdc),
    v_apertura: keepDoc(inc.v_apertura, existing.v_apertura),
    v_sal: keepDoc(inc.v_sal, existing.v_sal),
    bef: keepDoc(inc.bef, existing.bef),
    note_operative: inc.note_operative ?? existing.note_operative,
    // Preserve manual-edit flag metadata when not forcing.
    edited_manually: force ? false : existing.edited_manually,
    last_edited_at: existing.last_edited_at,
    last_edited_by: existing.last_edited_by,
  };
}

// Upsert from an Excel upload. Records flagged edited_manually are preserved
// unless `force` is set.
//
// With the neon-http driver every query is an HTTP round-trip, so the previous
// one-query-per-row flow made large uploads cost hundreds of sequential
// round-trips. Now: one batched read of the existing records, one batched
// insert, and the per-row updates run in parallel chunks.
export async function upsertInterventiFromUpload(
  incoming: Intervento[],
  force = false,
): Promise<UploadResult> {
  const insertedIfs: string[] = [];
  const updatedIfs: string[] = [];
  const skippedIfs: string[] = [];

  const ids = [...new Set(incoming.map((i) => i.numero_if))];
  const existingById = new Map<string, Intervento>();
  if (hasDB) {
    await ensureDbReady();
    if (ids.length) {
      const rows = await getDb().select().from(interventiTable).where(inArray(interventiTable.numero_if, ids));
      for (const r of rows) existingById.set(r.numero_if, rowToIntervento(r));
    }
  } else {
    for (const id of ids) {
      const e = await getInterventoAny(id);
      if (e) existingById.set(id, e);
    }
  }

  // Classify sequentially so duplicate numero_if rows inside the same file
  // still merge onto each other exactly like the previous one-by-one flow.
  const inserts = new Map<string, Intervento>();
  const updates = new Map<string, Intervento>();
  for (const inc of incoming) {
    const pending = inserts.get(inc.numero_if) ?? updates.get(inc.numero_if);
    const existing = pending ?? existingById.get(inc.numero_if);
    if (!existing) {
      inserts.set(inc.numero_if, inc);
      insertedIfs.push(inc.numero_if);
    } else if (!pending && existing.edited_manually && !force) {
      skippedIfs.push(inc.numero_if);
    } else {
      const merged = mergeUpload(existing, inc, force);
      if (inserts.has(inc.numero_if)) {
        inserts.set(inc.numero_if, merged);
      } else {
        if (!updates.has(inc.numero_if)) updatedIfs.push(inc.numero_if);
        updates.set(inc.numero_if, merged);
      }
    }
  }

  if (hasDB) {
    const insertRows = [...inserts.values()].map(interventoToRow);
    for (let i = 0; i < insertRows.length; i += 100) {
      await getDb().insert(interventiTable).values(insertRows.slice(i, i + 100));
    }
    const updEntries = [...updates.entries()];
    const CHUNK = 8;
    for (let i = 0; i < updEntries.length; i += CHUNK) {
      await Promise.all(
        updEntries.slice(i, i + CHUNK).map(([id, rec]) =>
          getDb()
            .update(interventiTable)
            .set({ ...interventoToRow(rec), deleted_at: null, updated_at: new Date() })
            .where(eq(interventiTable.numero_if, id)),
        ),
      );
    }
  } else {
    for (const rec of inserts.values()) await rawInsert(rec);
    for (const [id, rec] of updates) await rawUpdate(id, rec);
  }

  return {
    inserted: insertedIfs.length,
    updated: updatedIfs.length,
    skipped: skippedIfs.length,
    insertedIfs,
    updatedIfs,
    skippedIfs,
  };
}

// helpers that ignore soft-delete state (used by upload upsert)
async function getInterventoAny(numeroIf: string): Promise<Intervento | null> {
  if (hasDB) {
    const rows = await getDb()
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.numero_if, numeroIf));
    return rows[0] ? rowToIntervento(rows[0]) : null;
  }
  const r = mem().find((x) => x.numero_if === numeroIf);
  if (!r) return null;
  const { deleted_at, ...rest } = r;
  return rest;
}

async function rawInsert(i: Intervento) {
  if (hasDB) {
    await getDb().insert(interventiTable).values(interventoToRow(i));
    return;
  }
  mem().push({ ...i, deleted_at: null });
}

async function rawUpdate(numeroIf: string, i: Intervento) {
  if (hasDB) {
    await getDb()
      .update(interventiTable)
      .set({ ...interventoToRow(i), deleted_at: null, updated_at: new Date() })
      .where(eq(interventiTable.numero_if, numeroIf));
    return;
  }
  const list = mem();
  const idx = list.findIndex((x) => x.numero_if === numeroIf);
  if (idx >= 0) list[idx] = { ...i, deleted_at: null };
}
