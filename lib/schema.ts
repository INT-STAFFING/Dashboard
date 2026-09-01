import {
  pgTable,
  serial,
  text,
  numeric,
  boolean,
  date,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Field names mirror the canonical domain model (see lib/types.ts).
// `numero_if` is the natural/business key used by the CRUD API routes.
//
// Doc-status columns (pdc, v_apertura, v_sal, bef_status) and `attivazione`
// are enum-like text columns whose valid values were previously enforced
// only in application code (docToDb/docFromDb in lib/store.ts — see R-7 in
// docs/db-app-refactor-audit.md). The CHECK constraints below make the DB
// itself reject an out-of-domain value, including writes that bypass the
// store layer (e.g. the admin SQL console). NULL is always allowed: every
// one of these columns is nullable, and `x IN (...)` already evaluates to
// NULL (not FALSE) when x IS NULL, so it never blocks a missing value — the
// explicit `IS NULL OR` makes that intent readable rather than relying on
// three-valued-logic trivia. Doc-status values are the DocStatus domain
// itself (`'ok'|'ko'|'prog'|'nd'`), not the legacy display strings — see R-8.
export const interventi = pgTable(
  'interventi',
  {
    id: serial('id').primaryKey(),
    numero_if: text('numero_if').unique().notNull(),
    bdo: text('bdo'),
    titolo: text('titolo').notNull(),
    ambito: text('ambito'),
    fornitore: text('fornitore'),
    ref_aria: text('ref_aria'),
    ref_fornitore: text('ref_fornitore'),
    importo: numeric('importo', { precision: 15, scale: 4 }),
    revenue_2026: numeric('revenue_2026', { precision: 15, scale: 4 }),
    rev_mesi: jsonb('rev_mesi').$type<number[]>(),
    // Consuntivazione (actuals) per month, calendar order Gen..Dic (length 12).
    cons_mesi: jsonb('cons_mesi').$type<number[]>(),
    modalita_if: text('modalita_if'),
    attivazione: text('attivazione'), // 'SI' | 'NO'
    stato: text('stato'), // 'approvato' | 'non elaborato'
    has_bo: boolean('has_bo').default(false),
    pdc: text('pdc'), // 'ok' | 'ko' | 'prog' | 'nd' (DocStatus)
    v_apertura: text('v_apertura'),
    v_sal: text('v_sal'),
    bef_status: text('bef_status'),
    subappalto: boolean('subappalto').default(false),
    subappaltatore: jsonb('subappaltatore').$type<string[]>(),
    costo_subappalto: numeric('costo_subappalto', { precision: 15, scale: 4 }),
    data_assegnazione: date('data_assegnazione'),
    data_inizio: date('data_inizio'),
    data_fine: date('data_fine'),
    azione: text('azione'),
    note_operative: text('note_operative'),
    // Manual-edit tracking (drives merge-on-upload behaviour)
    edited_manually: boolean('edited_manually').default(false),
    last_edited_by: text('last_edited_by'),
    last_edited_at: timestamp('last_edited_at'),
    updated_at: timestamp('updated_at').defaultNow(),
    deleted_at: timestamp('deleted_at'), // NULL = active record (soft-delete)
  },
  (t) => ({
    pdcCheck: check('interventi_pdc_check', sql`${t.pdc} is null or ${t.pdc} in ('ok','ko','prog','nd')`),
    vAperturaCheck: check(
      'interventi_v_apertura_check',
      sql`${t.v_apertura} is null or ${t.v_apertura} in ('ok','ko','prog','nd')`,
    ),
    vSalCheck: check('interventi_v_sal_check', sql`${t.v_sal} is null or ${t.v_sal} in ('ok','ko','prog','nd')`),
    befStatusCheck: check(
      'interventi_bef_status_check',
      sql`${t.bef_status} is null or ${t.bef_status} in ('ok','ko','prog','nd')`,
    ),
    attivazioneCheck: check(
      'interventi_attivazione_check',
      sql`${t.attivazione} is null or ${t.attivazione} in ('SI','NO')`,
    ),
  }),
);

// Multiple rows per (numero_if, num_fattura) are EXPECTED and must be kept: a
// single invoice normally covers several BEF entries of the same intervento —
// one per BDO and per periodo di competenza. The unique index this table used
// to carry on that pair collapsed them into one row, silently dropping the
// amount of all the others from "Fatturato emesso" (dropped in
// drizzle/0010_bef_drop_fattura_unique.sql). Dedup on the real natural key
// (num_bdo, periodo_competenza, num_fattura) happens in lib/befStore.ts
// `upsertBef`, and replaceBef writes the resulting list wholesale per IF.
export const bef_records = pgTable('bef_records', {
  id: serial('id').primaryKey(),
  numero_if: text('numero_if'), // links a BEF row to its IF/BO
  num_bdo: text('num_bdo'),
  descrizione: text('descrizione'),
  periodo_competenza: text('periodo_competenza'),
  fornitore_reale: text('fornitore_reale'),
  importo_ricezione: numeric('importo_ricezione', { precision: 15, scale: 4 }),
  num_fattura: text('num_fattura'),
  data_fattura: date('data_fattura'),
  data_pagamento: date('data_pagamento'),
});

export const verbali_chiusura = pgTable('verbali_chiusura', {
  id: serial('id').primaryKey(),
  num_bdo: text('num_bdo'),
  descrizione: text('descrizione'),
  stato_verbale: text('stato_verbale'),
  fornitore: text('fornitore'),
  roi: text('roi'),
  data_firma_roi: date('data_firma_roi'),
});

// Snapshot of the "REPORT Bdo" export (workflow approvativo ROI/PMO/CTRM per
// BDO). num_bdo is the business key: one row per BDO, upserted on each
// upload. Only BDO already present in `interventi.bdo` are ever written here
// (see lib/reportBdoStore.ts) — this table never creates new interventi.
export const report_bdo = pgTable('report_bdo', {
  id: serial('id').primaryKey(),
  num_bdo: text('num_bdo').unique().notNull(),
  descrizione_bdo: text('descrizione_bdo'),
  nome_file_pif_if: text('nome_file_pif_if'),
  descrizione_pif_if: text('descrizione_pif_if'),
  codifica_documento: text('codifica_documento'),
  stato_documento: text('stato_documento'),
  divisione: text('divisione'),
  centro_costo: text('centro_costo'),
  ultima_pif_approvata: text('ultima_pif_approvata'),
  data_caricamento: date('data_caricamento'),
  utente_caricamento: text('utente_caricamento'),
  fornitore: text('fornitore'),
  roi: text('roi'),
  data_invio_roi: date('data_invio_roi'),
  data_approvazione_roi: date('data_approvazione_roi'),
  data_rifiuto_roi: date('data_rifiuto_roi'),
  pmo: text('pmo'),
  data_invio_pmo: date('data_invio_pmo'),
  data_approvazione_pmo: date('data_approvazione_pmo'),
  data_rifiuto_pmo: date('data_rifiuto_pmo'),
  ctrm: text('ctrm'),
  data_invio_ctrm: date('data_invio_ctrm'),
  data_approvazione_ctrm: date('data_approvazione_ctrm'),
  data_rifiuto_ctrm: date('data_rifiuto_ctrm'),
  versione_corrente: text('versione_corrente'),
  data_versione_corrente: date('data_versione_corrente'),
  data_decorrenza: date('data_decorrenza'),
  updated_at: timestamp('updated_at').defaultNow(),
});

// Snapshot of the "REPORT Rdi" export (Richieste di Intervento). numero_rdi is
// the business key: one row per RDI, upserted on each upload (same pattern as
// report_bdo).
export const report_rdi = pgTable('report_rdi', {
  id: serial('id').primaryKey(),
  numero_rdi: text('numero_rdi').unique().notNull(),
  descrizione_rdi: text('descrizione_rdi'),
  nome_file_pif_if: text('nome_file_pif_if'),
  codifica_documento: text('codifica_documento'),
  stato_documento: text('stato_documento'),
  divisione: text('divisione'),
  centro_costo: text('centro_costo'),
  ultima_pif_approvata: text('ultima_pif_approvata'),
  descrizione_pif_if: text('descrizione_pif_if'),
  data_caricamento: date('data_caricamento'),
  utente_caricamento: text('utente_caricamento'),
  fornitore: text('fornitore'),
  roi: text('roi'),
  data_invio_roi: date('data_invio_roi'),
  data_rifiuto_roi: date('data_rifiuto_roi'),
  data_approvazione_roi: date('data_approvazione_roi'),
  updated_at: timestamp('updated_at').defaultNow(),
});

// Snapshot of the "REPORT Apertura" export (verbali di apertura). Natural key
// for upsert-on-replace: (num_bdo, codifica_documento) — codifica_documento
// is the source system's per-document identifier, so it's the closest thing
// to a stable row identity here. Rows missing it (rare/edge-case exports)
// aren't deduplicable and are always replaced wholesale for that num_bdo —
// see lib/verbaliAperturaStore.ts.
export const verbali_apertura = pgTable(
  'verbali_apertura',
  {
    id: serial('id').primaryKey(),
    num_bdo: text('num_bdo'),
    descrizione: text('descrizione'),
    nome_file: text('nome_file'),
    codifica_documento: text('codifica_documento'),
    stato_verbale: text('stato_verbale'),
    periodo_competenza: text('periodo_competenza'),
    divisione: text('divisione'),
    centro_costo: text('centro_costo'),
    fornitore: text('fornitore'),
    utente_caricamento_fornitore: text('utente_caricamento_fornitore'),
    data_firma_fornitore: date('data_firma_fornitore'),
    roi: text('roi'),
    data_inserimento_verbale_non_sottomesso: date('data_inserimento_verbale_non_sottomesso'),
    data_sottomissione_verbale_fornitore: date('data_sottomissione_verbale_fornitore'),
    data_firma_roi: date('data_firma_roi'),
    data_rifiuto_roi: date('data_rifiuto_roi'),
    data_invio_roi: date('data_invio_roi'),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    num_bdo_codifica_unique: uniqueIndex('verbali_apertura_num_bdo_codifica_unique').on(
      t.num_bdo,
      t.codifica_documento,
    ),
  }),
);

// Snapshot of the "REPORT Sal" export (verbali SAL). Multiple rows per
// num_bdo are expected (periodic SAL) so uploads always append — see
// lib/verbaliSalStore.ts.
export const verbali_sal = pgTable('verbali_sal', {
  id: serial('id').primaryKey(),
  num_bdo: text('num_bdo'),
  descrizione: text('descrizione'),
  nome_file: text('nome_file'),
  codifica_documento: text('codifica_documento'),
  stato_verbale: text('stato_verbale'),
  periodo_competenza: text('periodo_competenza'),
  conforme: text('conforme'),
  motivo_conformita: text('motivo_conformita'),
  criticita: text('criticita'),
  motivazione_criticita: text('motivazione_criticita'),
  livelli_servizio_rispettati: text('livelli_servizio_rispettati'),
  divisione: text('divisione'),
  centro_costo: text('centro_costo'),
  fornitore: text('fornitore'),
  utente_caricamento_fornitore: text('utente_caricamento_fornitore'),
  data_firma_fornitore: date('data_firma_fornitore'),
  roi: text('roi'),
  data_inserimento_verbale_non_sottomesso: date('data_inserimento_verbale_non_sottomesso'),
  data_sottomissione_verbale_fornitore: date('data_sottomissione_verbale_fornitore'),
  data_firma_roi: date('data_firma_roi'),
  data_rifiuto_roi: date('data_rifiuto_roi'),
  data_invio_roi: date('data_invio_roi'),
  updated_at: timestamp('updated_at').defaultNow(),
});

// Snapshot of the "REPORT Pdc" export (Prese in Carico). Multiple rows per
// num_bdo are expected (one per posizione BDO x periodo di competenza) — the
// monthly detail behind interventi.pdc. Natural key for upsert-on-replace:
// (num_bdo, posizione_bdo, periodo_pdc), per that documented cardinality.
// Rows missing posizione_bdo or periodo_pdc aren't deduplicable and are
// always replaced wholesale for that num_bdo — see lib/reportPdcStore.ts.
export const report_pdc = pgTable(
  'report_pdc',
  {
    id: serial('id').primaryKey(),
    num_bdo: text('num_bdo'),
    posizione_bdo: text('posizione_bdo'),
    descrizione_posizione: text('descrizione_posizione'),
    importo_posizione: numeric('importo_posizione', { precision: 15, scale: 4 }),
    codice_pdc: text('codice_pdc'),
    periodo_pdc: text('periodo_pdc'),
    data_creazione: date('data_creazione'),
    utente_caricamento: text('utente_caricamento'),
    codifica_documento: text('codifica_documento'),
    stato_pdc: text('stato_pdc'),
    divisione: text('divisione'),
    centro_costo: text('centro_costo'),
    fornitore_rti: text('fornitore_rti'),
    roi: text('roi'),
    data_invio_roi: date('data_invio_roi'),
    data_rifiuto_roi: date('data_rifiuto_roi'),
    data_approvazione_roi: date('data_approvazione_roi'),
    fornitore_prestazione: text('fornitore_prestazione'),
    service_line: text('service_line'),
    tipo_fornitura: text('tipo_fornitura'),
    rdi: text('rdi'),
    posizione_rdi: text('posizione_rdi'),
    subappalto: text('subappalto'),
    subappaltatore: text('subappaltatore'),
    costo_subappalto: numeric('costo_subappalto', { precision: 15, scale: 4 }),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    num_bdo_posizione_periodo_unique: uniqueIndex('report_pdc_num_bdo_posizione_periodo_unique').on(
      t.num_bdo,
      t.posizione_bdo,
      t.periodo_pdc,
    ),
  }),
);

export const tariffe = pgTable('tariffe', {
  id: serial('id').primaryKey(),
  figura: text('figura'),
  sigla: text('sigla'),
  gg: integer('gg'),
  tariffa_giornaliera: numeric('tariffa_giornaliera', { precision: 10, scale: 4 }),
  tariffa_oraria: numeric('tariffa_oraria', { precision: 10, scale: 4 }),
});

// Application users with role-based access control.
//  - role:   'ADMIN' (full access, undeletable) | 'USERPLUS' (view+edit) | 'USER' (view only)
//  - status: 'pending' (awaiting admin approval) | 'approved' | 'rejected'
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').unique().notNull(),
    name: text('name'),
    password_hash: text('password_hash').notNull(),
    role: text('role').notNull().default('USER'),
    status: text('status').notNull().default('pending'),
    created_at: timestamp('created_at').defaultNow(),
    approved_at: timestamp('approved_at'),
  },
  (t) => ({
    // See R-7 in docs/db-app-refactor-audit.md: these were previously
    // validated only in application code.
    roleCheck: check('users_role_check', sql`${t.role} in ('ADMIN','USERPLUS','USER')`),
    statusCheck: check('users_status_check', sql`${t.status} in ('pending','approved','rejected')`),
  }),
);

// Per-IF/BO resource allocation: professional figures, working groups,
// man-days (giorni uomo) and daily rates for each intervento.
export const if_risorse = pgTable('if_risorse', {
  id: serial('id').primaryKey(),
  numero_if: text('numero_if').notNull(),
  figura: text('figura'),
  sigla: text('sigla'),
  gruppo: text('gruppo'), // gruppo di lavoro
  gg: numeric('gg', { precision: 10, scale: 2 }), // giorni uomo
  tariffa_giornaliera: numeric('tariffa_giornaliera', { precision: 12, scale: 4 }),
});

// Generic JSON settings store (valori di gara, timeline, tariffe globali …).
export const app_config = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updated_at: timestamp('updated_at').defaultNow(),
});

// Multi-year revenue/consuntivazione fact table (portfolio-level), one row per
// calendar (anno, mese). Anchoring on the calendar lets us derive both the
// solar year (Gen–Dic) and the fiscal year (Set–Ago, spanning two calendar
// years) at monthly / quarterly / annual grain. See lib/fiscal.ts.
export const timeline_mensile = pgTable(
  'timeline_mensile',
  {
    id: serial('id').primaryKey(),
    anno: integer('anno').notNull(),
    mese: integer('mese').notNull(), // 1..12 calendar
    revenue: numeric('revenue', { precision: 18, scale: 4 }),
    consuntivato: numeric('consuntivato', { precision: 18, scale: 4 }),
  },
  (t) => ({
    anno_mese_unique: uniqueIndex('timeline_mensile_anno_mese_unique').on(t.anno, t.mese),
  }),
);

export const config_rti = pgTable('config_rti', {
  id: serial('id').primaryKey(),
  massimale_totale: numeric('massimale_totale', { precision: 18, scale: 4 }),
  quota_intellera_pct: numeric('quota_intellera_pct', { precision: 5, scale: 2 }),
  quota_deloitte_pct: numeric('quota_deloitte_pct', { precision: 5, scale: 2 }),
  partners: jsonb('partners').$type<{ name: string; pct: number }[]>(),
  cig: text('cig'),
  contratto_ref: text('contratto_ref'),
  updated_at: timestamp('updated_at').defaultNow(),
});
