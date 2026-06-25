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
} from 'drizzle-orm/pg-core';

// Field names mirror the canonical domain model (see lib/types.ts).
// `numero_if` is the natural/business key used by the CRUD API routes.
export const interventi = pgTable('interventi', {
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
  pdc: text('pdc'), // 'OK' | 'Mancante' | 'InCorso' | 'ND'
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
});

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
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull().default('USER'),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').defaultNow(),
  approved_at: timestamp('approved_at'),
});

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
