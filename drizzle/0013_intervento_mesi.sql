-- Revenue e consuntivazione per IF, anno e mese (lib/mesiStore.ts): sostituisce gli
-- array a 12 valori di un solo anno (interventi.rev_mesi / cons_mesi /
-- revenue_2026), che legavano il modello al 2026. Le vecchie colonne restano in
-- tabella ma non vengono più lette né scritte.
-- Mirror di DDL / INTERVENTO_MESI_BACKFILL in lib/db.ts (SCHEMA_VERSION 9).
CREATE TABLE IF NOT EXISTS "intervento_mesi" (
	"numero_if" text NOT NULL,
	"anno" integer NOT NULL,
	"mese" integer NOT NULL,
	"revenue" numeric(15, 4) DEFAULT 0 NOT NULL,
	"consuntivo" numeric(15, 4) DEFAULT 0 NOT NULL,
	CONSTRAINT "intervento_mesi_pk" PRIMARY KEY ("numero_if","anno","mese"),
	CONSTRAINT "intervento_mesi_mese_check" CHECK ("mese" BETWEEN 1 AND 12)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intervento_mesi_anno_if_idx" ON "intervento_mesi" USING btree ("anno","numero_if");--> statement-breakpoint
-- Copia una tantum dei vecchi profili (solo mesi non nulli, solo valori numerici),
-- nell'anno a cui era ancorata la timeline legacy (default 2026). Scatta solo a
-- tabella vuota e non può far fallire la migrazione per dati malformati.
INSERT INTO "intervento_mesi" ("numero_if","anno","mese","revenue","consuntivo")
  SELECT i."numero_if", y."anno", m."n", COALESCE(v."rev", 0), COALESCE(v."cons", 0)
    FROM "interventi" i
   CROSS JOIN generate_series(1, 12) AS m("n")
   CROSS JOIN (
     SELECT COALESCE((
       SELECT CASE WHEN jsonb_typeof("value"->'anno') = 'number' AND ("value"->>'anno') ~ '^(20[0-9]{2}|2100)$'
                   THEN ("value"->>'anno')::int END
         FROM "app_config" WHERE "key" = 'timeline'
     ), 2026) AS "anno"
   ) y
   CROSS JOIN LATERAL (
     SELECT CASE WHEN jsonb_typeof(i."rev_mesi" -> (m."n" - 1)) = 'number' THEN (i."rev_mesi" ->> (m."n" - 1))::numeric END AS "rev",
            CASE WHEN jsonb_typeof(i."cons_mesi" -> (m."n" - 1)) = 'number' THEN (i."cons_mesi" ->> (m."n" - 1))::numeric END AS "cons"
   ) v
   WHERE NOT EXISTS (SELECT 1 FROM "intervento_mesi")
     AND (COALESCE(v."rev", 0) <> 0 OR COALESCE(v."cons", 0) <> 0)
  ON CONFLICT DO NOTHING;
