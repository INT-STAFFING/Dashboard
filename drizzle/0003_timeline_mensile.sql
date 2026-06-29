CREATE TABLE IF NOT EXISTS "timeline_mensile" (
	"id" serial PRIMARY KEY NOT NULL,
	"anno" integer NOT NULL,
	"mese" integer NOT NULL,
	"revenue" numeric(18, 4),
	"consuntivato" numeric(18, 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_mensile_anno_mese_unique" ON "timeline_mensile" ("anno","mese");
