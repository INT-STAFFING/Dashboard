CREATE TABLE IF NOT EXISTS "report_bdo" (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_mensile" (
	"id" serial PRIMARY KEY NOT NULL,
	"anno" integer NOT NULL,
	"mese" integer NOT NULL,
	"revenue" numeric(18, 4),
	"consuntivato" numeric(18, 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_mensile_anno_mese_unique" ON "timeline_mensile" USING btree ("anno","mese");