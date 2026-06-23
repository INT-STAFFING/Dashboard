CREATE TABLE IF NOT EXISTS "bef_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"num_bdo" text,
	"descrizione" text,
	"periodo_competenza" text,
	"fornitore_reale" text,
	"importo_ricezione" numeric(15, 4),
	"num_fattura" text,
	"data_fattura" date,
	"data_pagamento" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_rti" (
	"id" serial PRIMARY KEY NOT NULL,
	"massimale_totale" numeric(18, 4),
	"quota_intellera_pct" numeric(5, 2),
	"quota_deloitte_pct" numeric(5, 2),
	"partners" jsonb,
	"cig" text,
	"contratto_ref" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interventi" (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tariffe" (
	"id" serial PRIMARY KEY NOT NULL,
	"figura" text,
	"sigla" text,
	"gg" integer,
	"tariffa_giornaliera" numeric(10, 4),
	"tariffa_oraria" numeric(10, 4)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verbali_chiusura" (
	"id" serial PRIMARY KEY NOT NULL,
	"num_bdo" text,
	"descrizione" text,
	"stato_verbale" text,
	"fornitore" text,
	"roi" text,
	"data_firma_roi" date
);
