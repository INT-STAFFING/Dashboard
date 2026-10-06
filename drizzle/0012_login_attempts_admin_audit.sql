-- Rate limit del login (lib/auth/loginThrottle.ts) e audit trail della console
-- SQL admin (lib/adminAudit.ts). Mirror di DDL in lib/db.ts (SCHEMA_VERSION 8).
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_key_created_idx" ON "login_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_email" text,
	"action" text DEFAULT 'sql' NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"row_count" integer,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");
