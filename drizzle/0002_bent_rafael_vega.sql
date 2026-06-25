CREATE TABLE IF NOT EXISTS "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "if_risorse" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero_if" text NOT NULL,
	"figura" text,
	"sigla" text,
	"gruppo" text,
	"gg" numeric(10, 2),
	"tariffa_giornaliera" numeric(12, 4)
);
--> statement-breakpoint
ALTER TABLE "bef_records" ADD COLUMN "numero_if" text;--> statement-breakpoint
ALTER TABLE "interventi" ADD COLUMN "cons_mesi" jsonb;