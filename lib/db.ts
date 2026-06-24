import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
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
];

// Cache the successful bootstrap once per instance. A failed attempt is NOT
// cached, so transient errors can be retried on the next request.
let schemaPromise: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  const db = getDb();
  // neon-http executes a single statement per round-trip, so run them in order.
  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
  }
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

export { schema };
