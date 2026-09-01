-- Una fattura copre normalmente PIÙ righe BEF dello stesso intervento (una per
-- BDO e per periodo di competenza). L'indice unique introdotto da
-- 0007_organic_odin.sql su (numero_if, num_fattura) le collassava in una sola
-- riga — sia in fase di dedup pre-indice, sia ad ogni upload tramite
-- ON CONFLICT DO UPDATE — azzerando l'importo di tutte le altre nel KPI
-- "Fatturato emesso" e nel cumulato del grafico Timeline.
--
-- La deduplica corretta, sulla chiave naturale (num_bdo, periodo_competenza,
-- num_fattura), avviene ora in lib/befStore.ts (upsertBef), e replaceBef
-- riscrive l'elenco completo per numero_if dentro un'unica transazione.
DROP INDEX IF EXISTS "bef_records_numero_if_num_fattura_unique";--> statement-breakpoint
-- Fino alla correzione del parser, "Numero Fattura" veniva letto con `str`
-- invece che con `strId`: una cella numerica a cui il foglio aveva lasciato un
-- formato-data veniva restituita da xlsx come Date e salvata come timestamp
-- ("Mon Jan 05 2026 00:00:00 GMT+0100 (…)") anziché come numero di fattura.
-- Stessa riparazione già applicata a interventi/bef_records/if_risorse in
-- 0009 (vedi DATE_ID_REPAIRS in lib/db.ts): si ricostruisce il seriale Excel.
UPDATE "bef_records" a
   SET "num_fattura" = (make_date(
         (regexp_match(a."num_fattura", '^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{2}) ([0-9]{4,}) [0-9]{2}:[0-9]{2}:[0-9]{2} GMT'))[3]::int,
         array_position(
           ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
           (regexp_match(a."num_fattura", '^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{2}) ([0-9]{4,}) [0-9]{2}:[0-9]{2}:[0-9]{2} GMT'))[1]
         ),
         (regexp_match(a."num_fattura", '^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{2}) ([0-9]{4,}) [0-9]{2}:[0-9]{2}:[0-9]{2} GMT'))[2]::int
       ) - DATE '1899-12-30')::text
 WHERE a."num_fattura" ~ '^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{2}) ([0-9]{4,}) [0-9]{2}:[0-9]{2}:[0-9]{2} GMT';
