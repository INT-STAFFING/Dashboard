-- R-8 (docs/db-app-refactor-audit.md): pdc/v_apertura/v_sal/bef_status now
-- persist the DocStatus domain values ('ok'|'ko'|'prog'|'nd') directly
-- instead of the legacy display strings ('OK'|'Mancante'|'InCorso'|'ND').
-- The CHECK constraints added by R-7 (0008_abandoned_captain_cross.sql)
-- enforce the old strings by name, so they're dropped first — otherwise the
-- backfill UPDATE below would violate them on an already-provisioned DB —
-- then re-added against the new domain once every row has been converted.
ALTER TABLE "interventi" DROP CONSTRAINT "interventi_pdc_check";--> statement-breakpoint
ALTER TABLE "interventi" DROP CONSTRAINT "interventi_v_apertura_check";--> statement-breakpoint
ALTER TABLE "interventi" DROP CONSTRAINT "interventi_v_sal_check";--> statement-breakpoint
ALTER TABLE "interventi" DROP CONSTRAINT "interventi_bef_status_check";--> statement-breakpoint
UPDATE "interventi" SET "pdc" = CASE "pdc"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "pdc" IS NULL OR "pdc" NOT IN ('ok', 'ko', 'prog', 'nd');--> statement-breakpoint
UPDATE "interventi" SET "v_apertura" = CASE "v_apertura"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "v_apertura" IS NULL OR "v_apertura" NOT IN ('ok', 'ko', 'prog', 'nd');--> statement-breakpoint
UPDATE "interventi" SET "v_sal" = CASE "v_sal"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "v_sal" IS NULL OR "v_sal" NOT IN ('ok', 'ko', 'prog', 'nd');--> statement-breakpoint
UPDATE "interventi" SET "bef_status" = CASE "bef_status"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "bef_status" IS NULL OR "bef_status" NOT IN ('ok', 'ko', 'prog', 'nd');--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_pdc_check" CHECK ("interventi"."pdc" is null or "interventi"."pdc" in ('ok','ko','prog','nd'));--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_apertura_check" CHECK ("interventi"."v_apertura" is null or "interventi"."v_apertura" in ('ok','ko','prog','nd'));--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_sal_check" CHECK ("interventi"."v_sal" is null or "interventi"."v_sal" in ('ok','ko','prog','nd'));--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_bef_status_check" CHECK ("interventi"."bef_status" is null or "interventi"."bef_status" in ('ok','ko','prog','nd'));
