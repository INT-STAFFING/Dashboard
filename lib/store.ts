import { eq, isNull } from 'drizzle-orm';
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

const DEFAULTS: Omit<Intervento, 'numero_if' | 'titolo'> = {
  bdo: null,
  ambito: null,
  fornitore: 'Intellera',
  ref_aria: null,
  ref_fornitore: null,
  importo: 0,
  revenue_2026: 0,
  rev_mesi: Array(12).fill(0),
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

export type UploadResult = { inserted: number; updated: number; skipped: number };

// Upsert from an Excel upload. Records flagged edited_manually are preserved
// unless `force` is set.
export async function upsertInterventiFromUpload(
  incoming: Intervento[],
  force = false,
): Promise<UploadResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const inc of incoming) {
    const existing = await getInterventoAny(inc.numero_if);
    if (!existing) {
      await rawInsert(inc);
      inserted += 1;
    } else if (existing.edited_manually && !force) {
      skipped += 1;
    } else {
      // preserve manual-edit flag metadata when not forcing
      await rawUpdate(inc.numero_if, {
        ...inc,
        edited_manually: force ? false : existing.edited_manually,
        last_edited_at: existing.last_edited_at,
        last_edited_by: existing.last_edited_by,
        note_operative: inc.note_operative ?? existing.note_operative,
      });
      updated += 1;
    }
  }
  return { inserted, updated, skipped };
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
