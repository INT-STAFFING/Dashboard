import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Neon serverless Postgres connection string. The Vercel ⇄ Neon integration
// exposes it as DATABASE_URL / POSTGRES_URL — but when a custom prefix is set
// on the integration (e.g. "DASH"), every variable is prefixed
// (DASH_DATABASE_URL, DASH_POSTGRES_URL, …). We accept both so the app connects
// regardless of how the integration was configured. Pooled endpoints are
// preferred for the neon-http (serverless) driver.
export const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DASH_DATABASE_URL ||
  process.env.DASH_POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DASH_DATABASE_URL_UNPOOLED ||
  process.env.DASH_POSTGRES_URL_NON_POOLING ||
  '';

// Two modes:
//  - With a Neon connection string -> Drizzle / neon-http (persistent)
//  - Without it                    -> in-memory seed store (ephemeral, zero-config)
export const hasDB = Boolean(connectionString);

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!hasDB) {
    throw new Error('Database non configurato (DATABASE_URL / POSTGRES_URL mancante).');
  }
  if (!_db) {
    const sqlClient = neon(connectionString);
    _db = drizzle(sqlClient, { schema });
  }
  return _db;
}

// ---------------------------------------------------------------------------
// One-off repair: IF numbers stored as a JS Date string
// ---------------------------------------------------------------------------
// A source workbook that left a date number-format on the "N° IF" column made
// xlsx (cellDates) hand back a Date instead of the number, so an IF like
// 20260323 was read as its Excel serial date and persisted as
// "Fri Nov 16 57370 00:00:00 GMT+0100 (…)". lib/parsers/util.ts#strId now
// prevents that at ingest; these statements repair what already landed in the
// DB by converting the calendar parts back to the Excel serial — the number
// the cell actually held.
//
// Date.prototype.toString() is fixed-shape and always English for the weekday
// and month ("Fri Nov 16 57370 …"), whatever the uploader's locale, so this
// pattern matches the corruption and nothing else. Once a value is repaired it
// no longer matches, which keeps every statement a no-op on re-run.
const DATE_ID_RE =
  '^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{2}) ([0-9]{4,}) [0-9]{2}:[0-9]{2}:[0-9]{2} GMT';

// Excel's day-zero is 1899-12-30 (serial 1 = 1900-01-01, plus the phantom
// 1900-02-29), matching EXCEL_EPOCH_UTC in lib/parsers/util.ts.
const repairedId = (col: string) => `(make_date(
    (regexp_match(${col}, '${DATE_ID_RE}'))[3]::int,
    array_position(
      ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      (regexp_match(${col}, '${DATE_ID_RE}'))[1]
    ),
    (regexp_match(${col}, '${DATE_ID_RE}'))[2]::int
  ) - DATE '1899-12-30')::text`;

// The NOT EXISTS guards keep the repair from colliding with a row that already
// carries the correct id (a clean re-upload landed before this ran): such a
// duplicate is left alone rather than failing the whole bootstrap.
const DATE_ID_REPAIRS: string[] = [
  `UPDATE "interventi" a SET "numero_if" = ${repairedId('a."numero_if"')}
    WHERE a."numero_if" ~ '${DATE_ID_RE}'
      AND NOT EXISTS (
        SELECT 1 FROM "interventi" b
         WHERE b."numero_if" = ${repairedId('a."numero_if"')}
      )`,
  `UPDATE "interventi" a SET "bdo" = ${repairedId('a."bdo"')}
    WHERE a."bdo" ~ '${DATE_ID_RE}'`,
  `UPDATE "bef_records" a SET "numero_if" = ${repairedId('a."numero_if"')}
    WHERE a."numero_if" ~ '${DATE_ID_RE}'
      AND NOT EXISTS (
        SELECT 1 FROM "bef_records" b
         WHERE b."numero_if" = ${repairedId('a."numero_if"')}
           AND b."num_fattura" IS NOT DISTINCT FROM a."num_fattura"
      )`,
  `UPDATE "if_risorse" a SET "numero_if" = ${repairedId('a."numero_if"')}
    WHERE a."numero_if" ~ '${DATE_ID_RE}'`,
  // Stessa corruzione sul numero di fattura: fino alla correzione del parser
  // (lib/parsers/parseBEF.ts) la colonna "Numero Fattura" veniva letta con
  // `str` invece che con `strId`, quindi una cella numerica con formato-data
  // finiva salvata come timestamp anziché come numero di fattura.
  `UPDATE "bef_records" a SET "num_fattura" = ${repairedId('a."num_fattura"')}
    WHERE a."num_fattura" ~ '${DATE_ID_RE}'`,
];

// ---------------------------------------------------------------------------
// Self-provisioning schema
// ---------------------------------------------------------------------------
// Idempotent CREATE TABLE IF NOT EXISTS statements. Running these on first DB
// access lets the app bootstrap a fresh Neon database without a manual
// `db:push` / migration step — essential on serverless, where any missing
// table would otherwise make every request (login included) throw a 500.
// Keep these in sync with lib/schema.ts and the SQL in drizzle/*.sql.
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" serial PRIMARY KEY NOT NULL,
    "email" text NOT NULL,
    "name" text,
    "password_hash" text NOT NULL,
    "role" text DEFAULT 'USER' NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp DEFAULT now(),
    "approved_at" timestamp,
    CONSTRAINT "users_email_unique" UNIQUE("email")
  )`,
  `CREATE TABLE IF NOT EXISTS "interventi" (
    "id" serial PRIMARY KEY NOT NULL,
    "numero_if" text NOT NULL,
    "bdo" text,
    "titolo" text NOT NULL,
    "ambito" text,
    "fornitore" text,
    "ref_aria" text,
    "ref_fornitore" text,
    "importo" numeric(15, 4),
    "revenue_2026" numeric(15, 4),
    "rev_mesi" jsonb,
    "cons_mesi" jsonb,
    "modalita_if" text,
    "attivazione" text,
    "stato" text,
    "has_bo" boolean DEFAULT false,
    "pdc" text,
    "v_apertura" text,
    "v_sal" text,
    "bef_status" text,
    "subappalto" boolean DEFAULT false,
    "subappaltatore" jsonb,
    "costo_subappalto" numeric(15, 4),
    "data_assegnazione" date,
    "data_inizio" date,
    "data_fine" date,
    "azione" text,
    "note_operative" text,
    "edited_manually" boolean DEFAULT false,
    "last_edited_by" text,
    "last_edited_at" timestamp,
    "updated_at" timestamp DEFAULT now(),
    "deleted_at" timestamp,
    CONSTRAINT "interventi_numero_if_unique" UNIQUE("numero_if")
  )`,
  `CREATE TABLE IF NOT EXISTS "bef_records" (
    "id" serial PRIMARY KEY NOT NULL,
    "numero_if" text,
    "num_bdo" text,
    "descrizione" text,
    "periodo_competenza" text,
    "fornitore_reale" text,
    "importo_ricezione" numeric(15, 4),
    "num_fattura" text,
    "data_fattura" date,
    "data_pagamento" date
  )`,
  `CREATE TABLE IF NOT EXISTS "verbali_chiusura" (
    "id" serial PRIMARY KEY NOT NULL,
    "num_bdo" text,
    "descrizione" text,
    "stato_verbale" text,
    "fornitore" text,
    "roi" text,
    "data_firma_roi" date
  )`,
  `CREATE TABLE IF NOT EXISTS "report_bdo" (
    "id" serial PRIMARY KEY NOT NULL,
    "num_bdo" text NOT NULL,
    "descrizione_bdo" text,
    "nome_file_pif_if" text,
    "descrizione_pif_if" text,
    "codifica_documento" text,
    "stato_documento" text,
    "divisione" text,
    "centro_costo" text,
    "ultima_pif_approvata" text,
    "data_caricamento" date,
    "utente_caricamento" text,
    "fornitore" text,
    "roi" text,
    "data_invio_roi" date,
    "data_approvazione_roi" date,
    "data_rifiuto_roi" date,
    "pmo" text,
    "data_invio_pmo" date,
    "data_approvazione_pmo" date,
    "data_rifiuto_pmo" date,
    "ctrm" text,
    "data_invio_ctrm" date,
    "data_approvazione_ctrm" date,
    "data_rifiuto_ctrm" date,
    "versione_corrente" text,
    "data_versione_corrente" date,
    "data_decorrenza" date,
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "report_bdo_num_bdo_unique" UNIQUE("num_bdo")
  )`,
  `CREATE TABLE IF NOT EXISTS "report_rdi" (
    "id" serial PRIMARY KEY NOT NULL,
    "numero_rdi" text NOT NULL,
    "descrizione_rdi" text,
    "nome_file_pif_if" text,
    "codifica_documento" text,
    "stato_documento" text,
    "divisione" text,
    "centro_costo" text,
    "ultima_pif_approvata" text,
    "descrizione_pif_if" text,
    "data_caricamento" date,
    "utente_caricamento" text,
    "fornitore" text,
    "roi" text,
    "data_invio_roi" date,
    "data_rifiuto_roi" date,
    "data_approvazione_roi" date,
    "updated_at" timestamp DEFAULT now(),
    CONSTRAINT "report_rdi_numero_rdi_unique" UNIQUE("numero_rdi")
  )`,
  `CREATE TABLE IF NOT EXISTS "verbali_apertura" (
    "id" serial PRIMARY KEY NOT NULL,
    "num_bdo" text,
    "descrizione" text,
    "nome_file" text,
    "codifica_documento" text,
    "stato_verbale" text,
    "periodo_competenza" text,
    "divisione" text,
    "centro_costo" text,
    "fornitore" text,
    "utente_caricamento_fornitore" text,
    "data_firma_fornitore" date,
    "roi" text,
    "data_inserimento_verbale_non_sottomesso" date,
    "data_sottomissione_verbale_fornitore" date,
    "data_firma_roi" date,
    "data_rifiuto_roi" date,
    "data_invio_roi" date,
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "verbali_sal" (
    "id" serial PRIMARY KEY NOT NULL,
    "num_bdo" text,
    "descrizione" text,
    "nome_file" text,
    "codifica_documento" text,
    "stato_verbale" text,
    "periodo_competenza" text,
    "conforme" text,
    "motivo_conformita" text,
    "criticita" text,
    "motivazione_criticita" text,
    "livelli_servizio_rispettati" text,
    "divisione" text,
    "centro_costo" text,
    "fornitore" text,
    "utente_caricamento_fornitore" text,
    "data_firma_fornitore" date,
    "roi" text,
    "data_inserimento_verbale_non_sottomesso" date,
    "data_sottomissione_verbale_fornitore" date,
    "data_firma_roi" date,
    "data_rifiuto_roi" date,
    "data_invio_roi" date,
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "report_pdc" (
    "id" serial PRIMARY KEY NOT NULL,
    "num_bdo" text,
    "posizione_bdo" text,
    "descrizione_posizione" text,
    "importo_posizione" numeric(15, 4),
    "codice_pdc" text,
    "periodo_pdc" text,
    "data_creazione" date,
    "utente_caricamento" text,
    "codifica_documento" text,
    "stato_pdc" text,
    "divisione" text,
    "centro_costo" text,
    "fornitore_rti" text,
    "roi" text,
    "data_invio_roi" date,
    "data_rifiuto_roi" date,
    "data_approvazione_roi" date,
    "fornitore_prestazione" text,
    "service_line" text,
    "tipo_fornitura" text,
    "rdi" text,
    "posizione_rdi" text,
    "subappalto" text,
    "subappaltatore" text,
    "costo_subappalto" numeric(15, 4),
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "tariffe" (
    "id" serial PRIMARY KEY NOT NULL,
    "figura" text,
    "sigla" text,
    "gg" integer,
    "tariffa_giornaliera" numeric(10, 4),
    "tariffa_oraria" numeric(10, 4)
  )`,
  `CREATE TABLE IF NOT EXISTS "config_rti" (
    "id" serial PRIMARY KEY NOT NULL,
    "massimale_totale" numeric(18, 4),
    "quota_intellera_pct" numeric(5, 2),
    "quota_deloitte_pct" numeric(5, 2),
    "partners" jsonb,
    "cig" text,
    "contratto_ref" text,
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "if_risorse" (
    "id" serial PRIMARY KEY NOT NULL,
    "numero_if" text NOT NULL,
    "figura" text,
    "sigla" text,
    "gruppo" text,
    "gg" numeric(10, 2),
    "tariffa_giornaliera" numeric(12, 4)
  )`,
  `CREATE TABLE IF NOT EXISTS "app_config" (
    "key" text PRIMARY KEY NOT NULL,
    "value" jsonb,
    "updated_at" timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "timeline_mensile" (
    "id" serial PRIMARY KEY NOT NULL,
    "anno" integer NOT NULL,
    "mese" integer NOT NULL,
    "revenue" numeric(18, 4),
    "consuntivato" numeric(18, 4)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "timeline_mensile_anno_mese_unique" ON "timeline_mensile" ("anno","mese")`,
  // Per-IF lookups (admin editors, BEF upsert) filter on numero_if.
  `CREATE INDEX IF NOT EXISTS "bef_records_numero_if_idx" ON "bef_records" ("numero_if")`,
  `CREATE INDEX IF NOT EXISTS "if_risorse_numero_if_idx" ON "if_risorse" ("numero_if")`,
  // Monthly-detail lookups (Dettaglio IF drill-down) filter on num_bdo.
  `CREATE INDEX IF NOT EXISTS "report_pdc_num_bdo_idx" ON "report_pdc" ("num_bdo")`,
  `CREATE INDEX IF NOT EXISTS "verbali_sal_num_bdo_idx" ON "verbali_sal" ("num_bdo")`,
  `CREATE INDEX IF NOT EXISTS "bef_records_num_bdo_idx" ON "bef_records" ("num_bdo")`,
  // Idempotent column additions for databases created before these fields
  // existed (CREATE TABLE IF NOT EXISTS won't add columns to an existing table).
  `ALTER TABLE "interventi" ADD COLUMN IF NOT EXISTS "cons_mesi" jsonb`,
  `ALTER TABLE "bef_records" ADD COLUMN IF NOT EXISTS "numero_if" text`,
  // Natural keys for upsert-on-replace (see lib/befStore.ts, lib/reportPdcStore.ts,
  // lib/verbaliAperturaStore.ts). De-duplicate first: a DB populated by the old
  // (non-deduplicating) delete-all-per-num_bdo pattern can already have rows
  // sharing what's about to become a natural key — keep the most recently
  // written row (highest id) per duplicate group, matching drizzle/0007_organic_odin.sql.
  `DELETE FROM "report_pdc" a USING "report_pdc" b
    WHERE a."num_bdo" = b."num_bdo" AND a."posizione_bdo" = b."posizione_bdo" AND a."periodo_pdc" = b."periodo_pdc"
      AND a."posizione_bdo" IS NOT NULL AND a."periodo_pdc" IS NOT NULL AND a."id" < b."id"`,
  `DELETE FROM "verbali_apertura" a USING "verbali_apertura" b
    WHERE a."num_bdo" = b."num_bdo" AND a."codifica_documento" = b."codifica_documento"
      AND a."codifica_documento" IS NOT NULL AND a."id" < b."id"`,
  // bef_records ha invece NESSUNA unique su (numero_if, num_fattura): una
  // fattura copre normalmente più righe BEF dello stesso IF (una per BDO e per
  // periodo di competenza) e l'indice le collassava in una sola, azzerando
  // l'importo di tutte le altre nel KPI "Fatturato emesso". Va rimosso anche
  // dai DB creati prima (vedi drizzle/0010_bef_drop_fattura_unique.sql).
  `DROP INDEX IF EXISTS "bef_records_numero_if_num_fattura_unique"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "report_pdc_num_bdo_posizione_periodo_unique" ON "report_pdc" ("num_bdo","posizione_bdo","periodo_pdc")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "verbali_apertura_num_bdo_codifica_unique" ON "verbali_apertura" ("num_bdo","codifica_documento")`,
  // Domain CHECK constraints for enum-like text columns previously validated
  // only in application code (docToDb/docFromDb + role/status literals in
  // lib/store.ts, lib/users.ts — see R-7 in docs/db-app-refactor-audit.md).
  // Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so each is wrapped in a
  // DO block that swallows the "already exists" error to stay idempotent
  // across re-runs of this array. NOT VALID adds the constraint without
  // scanning/validating existing rows — required here because this bootstrap
  // may run against an already-populated Neon database whose historical data
  // this codebase can't inspect ahead of time. New writes are enforced
  // immediately regardless (NOT VALID only exempts pre-existing rows); a
  // separate, optional `VALIDATE CONSTRAINT` pass can clean up stale data
  // later without blocking every request in the meantime.
  `DO $$ BEGIN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
      CHECK ("role" IN ('ADMIN','USERPLUS','USER')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "users" ADD CONSTRAINT "users_status_check"
      CHECK ("status" IN ('pending','approved','rejected')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_pdc_check"
      CHECK ("pdc" IS NULL OR "pdc" IN ('OK','Mancante','InCorso','ND')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_apertura_check"
      CHECK ("v_apertura" IS NULL OR "v_apertura" IN ('OK','Mancante','InCorso','ND')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_sal_check"
      CHECK ("v_sal" IS NULL OR "v_sal" IN ('OK','Mancante','InCorso','ND')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_bef_status_check"
      CHECK ("bef_status" IS NULL OR "bef_status" IN ('OK','Mancante','InCorso','ND')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_attivazione_check"
      CHECK ("attivazione" IS NULL OR "attivazione" IN ('SI','NO')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  // Doc-status columns now persist the DocStatus domain directly
  // ('ok'|'ko'|'prog'|'nd') instead of the legacy display strings
  // ('OK'|'Mancante'|'InCorso'|'ND') — see R-8 in
  // docs/db-app-refactor-audit.md. The v3 DO blocks above added the CHECK
  // constraints by name against the old domain, so simply re-running an
  // "ADD CONSTRAINT" with the same name would be swallowed by
  // duplicate_object without ever loosening it — each constraint is dropped
  // first (idempotent via IF EXISTS), the column backfilled, then the
  // constraint re-added against the new domain.
  `ALTER TABLE "interventi" DROP CONSTRAINT IF EXISTS "interventi_pdc_check"`,
  `ALTER TABLE "interventi" DROP CONSTRAINT IF EXISTS "interventi_v_apertura_check"`,
  `ALTER TABLE "interventi" DROP CONSTRAINT IF EXISTS "interventi_v_sal_check"`,
  `ALTER TABLE "interventi" DROP CONSTRAINT IF EXISTS "interventi_bef_status_check"`,
  `UPDATE "interventi" SET "pdc" = CASE "pdc"
      WHEN 'OK' THEN 'ok' WHEN 'Mancante' THEN 'ko' WHEN 'InCorso' THEN 'prog' WHEN 'ND' THEN 'nd' ELSE 'nd' END
    WHERE "pdc" IS NULL OR "pdc" NOT IN ('ok','ko','prog','nd')`,
  `UPDATE "interventi" SET "v_apertura" = CASE "v_apertura"
      WHEN 'OK' THEN 'ok' WHEN 'Mancante' THEN 'ko' WHEN 'InCorso' THEN 'prog' WHEN 'ND' THEN 'nd' ELSE 'nd' END
    WHERE "v_apertura" IS NULL OR "v_apertura" NOT IN ('ok','ko','prog','nd')`,
  `UPDATE "interventi" SET "v_sal" = CASE "v_sal"
      WHEN 'OK' THEN 'ok' WHEN 'Mancante' THEN 'ko' WHEN 'InCorso' THEN 'prog' WHEN 'ND' THEN 'nd' ELSE 'nd' END
    WHERE "v_sal" IS NULL OR "v_sal" NOT IN ('ok','ko','prog','nd')`,
  `UPDATE "interventi" SET "bef_status" = CASE "bef_status"
      WHEN 'OK' THEN 'ok' WHEN 'Mancante' THEN 'ko' WHEN 'InCorso' THEN 'prog' WHEN 'ND' THEN 'nd' ELSE 'nd' END
    WHERE "bef_status" IS NULL OR "bef_status" NOT IN ('ok','ko','prog','nd')`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_pdc_check"
      CHECK ("pdc" IS NULL OR "pdc" IN ('ok','ko','prog','nd')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_apertura_check"
      CHECK ("v_apertura" IS NULL OR "v_apertura" IN ('ok','ko','prog','nd')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_sal_check"
      CHECK ("v_sal" IS NULL OR "v_sal" IN ('ok','ko','prog','nd')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  `DO $$ BEGIN
    ALTER TABLE "interventi" ADD CONSTRAINT "interventi_bef_status_check"
      CHECK ("bef_status" IS NULL OR "bef_status" IN ('ok','ko','prog','nd')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
  // Repair IF/BO identifiers persisted as a JS Date string (DATE_ID_REPAIRS above).
  ...DATE_ID_REPAIRS,
];

// Bump this whenever the DDL array above changes (new table, new column, new
// index/constraint) and add a one-line note of what changed. Every statement
// in DDL is idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
// so re-running the whole array is always safe — this version only exists to
// let a warm instance skip the 28 round-trips when nothing changed since the
// last successful bootstrap.
//   1 — initial versioned baseline (schema as of the R-4 refactor)
//   2 — natural-key unique indexes for upsert-on-replace on bef_records,
//       report_pdc, verbali_apertura (R-2), with duplicate cleanup first
//   3 — CHECK constraints on enum-like columns: users.role, users.status,
//       interventi.pdc/v_apertura/v_sal/bef_status/attivazione (R-7)
//   4 — doc-status columns backfilled from the legacy display strings
//       ('OK'/'Mancante'/'InCorso'/'ND') to the DocStatus domain values
//       ('ok'/'ko'/'prog'/'nd'), with the R-7 CHECK constraints updated to
//       match (R-8)
//   5 — IF/BO identifiers persisted as a JS Date string ("Fri Nov 16 57370 …")
//       converted back to the Excel serial they really are, on interventi,
//       bef_records and if_risorse
//   6 — unique index bef_records(numero_if, num_fattura) rimosso: una fattura
//       copre più righe BEF dello stesso IF e l'indice le collassava in una
//       sola, sottostimando il "Fatturato emesso"; stessa riparazione del
//       punto 5 estesa a bef_records.num_fattura
// Exported so cached payloads assembled from these tables can key off it: a
// bootstrap that rewrites existing rows (the DATE_ID_REPAIRS above) changes what
// a read returns without going through any app write path, so nothing calls
// `revalidateTag`. Cache keys that include this version rebuild on the bump
// instead of serving data assembled before the repair — see lib/getDashboardData.ts.
export const SCHEMA_VERSION = 6;
const SCHEMA_VERSION_KEY = 'schema_version';

// Reads the current schema_version from app_config with a single round-trip.
// Returns null when the sentinel can't be read yet — either app_config
// doesn't exist yet (fresh DB) or the key was never written — so the caller
// knows it must run the full DDL bootstrap.
async function readSchemaVersion(db: ReturnType<typeof getDb>): Promise<number | null> {
  try {
    const result = (await db.execute(
      sql`select value from app_config where key = ${SCHEMA_VERSION_KEY} limit 1`,
    )) as unknown as { rows?: { value: unknown }[] } | { value: unknown }[];
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    if (!rows.length || rows[0].value == null) return null;
    const v = Number(rows[0].value);
    return Number.isFinite(v) ? v : null;
  } catch {
    // app_config doesn't exist yet on a brand-new database.
    return null;
  }
}

async function writeSchemaVersion(db: ReturnType<typeof getDb>): Promise<void> {
  const json = JSON.stringify(SCHEMA_VERSION);
  await db.execute(
    sql`insert into app_config (key, value, updated_at)
        values (${SCHEMA_VERSION_KEY}, ${json}::jsonb, now())
        on conflict (key) do update set value = ${json}::jsonb, updated_at = now()`,
  );
}

// Cache the successful bootstrap once per instance. A failed attempt is NOT
// cached, so transient errors can be retried on the next request.
let schemaPromise: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  const db = getDb();
  // Fast path: a warm database already at the current schema version needs
  // just this one round-trip instead of the full DDL array below.
  const current = await readSchemaVersion(db);
  if (current !== null && current >= SCHEMA_VERSION) return;

  // neon-http executes a single statement per round-trip, so run them in order.
  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
  }
  await writeSchemaVersion(db);
}

export async function ensureSchema(): Promise<void> {
  if (!hasDB) return;
  if (!schemaPromise) {
    schemaPromise = bootstrap().catch((e) => {
      schemaPromise = null; // allow retry on next call
      throw e;
    });
  }
  return schemaPromise;
}

// Builds the `set` clause for `.onConflictDoUpdate()`: every column of
// `table` except `exclude` (typically the id and the natural-key columns
// targeted by the conflict), mapped to `excluded."<column>"` so the incoming
// row's values win on conflict. Shared by the upsert-on-replace stores
// (befStore, reportPdcStore, verbaliAperturaStore — see R-2) so the update
// set can't drift out of sync with the table's actual columns.
export function excludedSet<T extends PgTable>(table: T, exclude: string[]): Record<string, SQL> {
  const columns = getTableColumns(table);
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(columns)) {
    if (exclude.includes(key)) continue;
    set[key] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

export { schema };
