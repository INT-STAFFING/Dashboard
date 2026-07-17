-- De-duplicate before adding UNIQUE indexes: on a DB populated by the old
-- (non-deduplicating) delete-all-per-num_bdo upload pattern, two rows can
-- already share what is about to become a natural key. For each duplicate
-- group, keep only the most recently written row (highest id) and drop the
-- rest, so the CREATE UNIQUE INDEX statements below don't fail on existing
-- data. Idempotent: no-op once no duplicates remain.
DELETE FROM "bef_records" a USING "bef_records" b
WHERE a."numero_if" = b."numero_if"
  AND a."num_fattura" = b."num_fattura"
  AND a."num_fattura" IS NOT NULL
  AND a."id" < b."id";--> statement-breakpoint
DELETE FROM "report_pdc" a USING "report_pdc" b
WHERE a."num_bdo" = b."num_bdo"
  AND a."posizione_bdo" = b."posizione_bdo"
  AND a."periodo_pdc" = b."periodo_pdc"
  AND a."posizione_bdo" IS NOT NULL
  AND a."periodo_pdc" IS NOT NULL
  AND a."id" < b."id";--> statement-breakpoint
DELETE FROM "verbali_apertura" a USING "verbali_apertura" b
WHERE a."num_bdo" = b."num_bdo"
  AND a."codifica_documento" = b."codifica_documento"
  AND a."codifica_documento" IS NOT NULL
  AND a."id" < b."id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bef_records_numero_if_num_fattura_unique" ON "bef_records" USING btree ("numero_if","num_fattura");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_pdc_num_bdo_posizione_periodo_unique" ON "report_pdc" USING btree ("num_bdo","posizione_bdo","periodo_pdc");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verbali_apertura_num_bdo_codifica_unique" ON "verbali_apertura" USING btree ("num_bdo","codifica_documento");
