-- NOT VALID added by hand after `drizzle-kit generate` (R-7, see
-- docs/db-app-refactor-audit.md): this migration may run against an
-- already-populated database whose historical data can't be inspected ahead
-- of time. NOT VALID adds each constraint without scanning/validating
-- existing rows, while still enforcing it on every new INSERT/UPDATE from
-- this point on. Run `ALTER TABLE ... VALIDATE CONSTRAINT ...` separately
-- (out of band, doesn't block reads/writes) once any pre-existing
-- out-of-domain values have been cleaned up, if full validation is needed.
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_pdc_check" CHECK ("interventi"."pdc" is null or "interventi"."pdc" in ('OK','Mancante','InCorso','ND')) NOT VALID;--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_apertura_check" CHECK ("interventi"."v_apertura" is null or "interventi"."v_apertura" in ('OK','Mancante','InCorso','ND')) NOT VALID;--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_v_sal_check" CHECK ("interventi"."v_sal" is null or "interventi"."v_sal" in ('OK','Mancante','InCorso','ND')) NOT VALID;--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_bef_status_check" CHECK ("interventi"."bef_status" is null or "interventi"."bef_status" in ('OK','Mancante','InCorso','ND')) NOT VALID;--> statement-breakpoint
ALTER TABLE "interventi" ADD CONSTRAINT "interventi_attivazione_check" CHECK ("interventi"."attivazione" is null or "interventi"."attivazione" in ('SI','NO')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('ADMIN','USERPLUS','USER')) NOT VALID;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" in ('pending','approved','rejected')) NOT VALID;