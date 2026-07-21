-- Backfill interventi doc-status columns from the old display strings
-- ('OK' | 'Mancante' | 'InCorso' | 'ND') to the DocStatus domain values
-- ('ok' | 'ko' | 'prog' | 'nd') now persisted directly by lib/store.ts.
UPDATE "interventi" SET "pdc" = CASE "pdc"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "pdc" IS NULL OR "pdc" NOT IN ('ok', 'ko', 'prog', 'nd');
--> statement-breakpoint
UPDATE "interventi" SET "v_apertura" = CASE "v_apertura"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "v_apertura" IS NULL OR "v_apertura" NOT IN ('ok', 'ko', 'prog', 'nd');
--> statement-breakpoint
UPDATE "interventi" SET "v_sal" = CASE "v_sal"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "v_sal" IS NULL OR "v_sal" NOT IN ('ok', 'ko', 'prog', 'nd');
--> statement-breakpoint
UPDATE "interventi" SET "bef_status" = CASE "bef_status"
	WHEN 'OK' THEN 'ok'
	WHEN 'Mancante' THEN 'ko'
	WHEN 'InCorso' THEN 'prog'
	WHEN 'ND' THEN 'nd'
	ELSE 'nd'
END
WHERE "bef_status" IS NULL OR "bef_status" NOT IN ('ok', 'ko', 'prog', 'nd');
