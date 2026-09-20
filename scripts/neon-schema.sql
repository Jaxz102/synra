-- Synra production schema for Neon (Postgres).
--
-- Generated from drizzle/0000_high_lionheart.sql + drizzle/0001_alpaca_orders.sql, i.e. the
-- state of lib/db/schema.ts as of 2026-09-20. Idempotent: safe to run more than once.
--
-- Usage: paste into the Neon SQL editor, or
--   psql "$PRODUCTION_DATABASE_URL" -f scripts/neon-schema.sql
--
-- The final block records both migrations in drizzle's journal table so that a later
-- `NODE_ENV=production bun run db:migrate` only applies migrations newer than 0001.
-- When lib/db/schema.ts changes: `bun run db:generate` and apply the new drizzle/*.sql
-- with db:migrate (or append it here, including its journal row).

BEGIN;

CREATE TABLE IF NOT EXISTS "poll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"cursor_before" text,
	"cursor_after" text,
	"feed_entries" integer DEFAULT 0 NOT NULL,
	"new_filings" integer DEFAULT 0 NOT NULL,
	"skipped_10b5_1" integer DEFAULT 0 NOT NULL,
	"skipped_sell" integer DEFAULT 0 NOT NULL,
	"skipped_not_purchase" integer DEFAULT 0 NOT NULL,
	"skipped_routine" integer DEFAULT 0 NOT NULL,
	"posted" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error" text
);

CREATE TABLE IF NOT EXISTS "filings" (
	"accession" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"issuer_cik" text,
	"issuer_name" text,
	"ticker" text,
	"insider_cik" text,
	"insider_name" text,
	"insider_role" text,
	"feed_updated" timestamp with time zone NOT NULL,
	"filed_date" text,
	"period_of_report" text,
	"status" text NOT NULL,
	"reason" text,
	"run_id" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"index_url" text,
	"xml_url" text,
	"form" jsonb
);

CREATE TABLE IF NOT EXISTS "form4_cache" (
	"accession" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "issuer_cache" (
	"cik" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "insider_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"accession" text NOT NULL,
	"insider_cik" text NOT NULL,
	"issuer_cik" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"classification" text NOT NULL,
	"confidence" double precision,
	"reasoning" text,
	"pattern_summary" text,
	"history" jsonb,
	"prompt_tokens" integer,
	"completion_tokens" integer
);

CREATE TABLE IF NOT EXISTS "insiders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"relationship" text,
	"company" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "stocks" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text,
	"company_name" text NOT NULL,
	"exchange" text,
	"sector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"insider_id" text NOT NULL,
	"stock_id" text NOT NULL,
	"trade_type" text NOT NULL,
	"shares" bigint NOT NULL,
	"price_per_share" numeric(18, 4),
	"total_value" numeric(18, 2),
	"trade_date" text,
	"filing_date" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shares_after" double precision,
	"transactions" jsonb NOT NULL,
	"ai_classification" text,
	"ai_confidence" double precision,
	"ai_reasoning" text,
	"ai_pattern" text,
	"ai_model" text,
	"history" jsonb,
	"filing_url" text,
	"alpaca_order_id" text,
	"alpaca_client_order_id" text,
	"alpaca_order_status" text,
	"alpaca_order_notional" numeric(18, 2),
	"alpaca_order_qty" double precision,
	"alpaca_order_error" text,
	"alpaca_ordered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);

-- Foreign keys (ADD CONSTRAINT has no IF NOT EXISTS, so guard via pg_constraint).
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filings_run_id_poll_runs_id_fk') THEN
		ALTER TABLE "filings" ADD CONSTRAINT "filings_run_id_poll_runs_id_fk"
			FOREIGN KEY ("run_id") REFERENCES "public"."poll_runs"("id") ON DELETE no action ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_insider_id_insiders_id_fk') THEN
		ALTER TABLE "trades" ADD CONSTRAINT "trades_insider_id_insiders_id_fk"
			FOREIGN KEY ("insider_id") REFERENCES "public"."insiders"("id") ON DELETE no action ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_stock_id_stocks_id_fk') THEN
		ALTER TABLE "trades" ADD CONSTRAINT "trades_stock_id_stocks_id_fk"
			FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "filings_status_idx" ON "filings" USING btree ("status");
CREATE INDEX IF NOT EXISTS "filings_feed_updated_idx" ON "filings" USING btree ("feed_updated" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "insider_analyses_accession_idx" ON "insider_analyses" USING btree ("accession");
CREATE INDEX IF NOT EXISTS "stocks_ticker_idx" ON "stocks" USING btree ("ticker");
CREATE INDEX IF NOT EXISTS "trades_stock_id_idx" ON "trades" USING btree ("stock_id");
CREATE INDEX IF NOT EXISTS "trades_insider_id_idx" ON "trades" USING btree ("insider_id");
CREATE INDEX IF NOT EXISTS "trades_trade_date_idx" ON "trades" USING btree ("trade_date" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "trades_posted_at_idx" ON "trades" USING btree ("posted_at" DESC NULLS LAST);

-- Drizzle migration journal: mark 0000 and 0001 as applied. Hashes are sha256 of the
-- migration files; created_at values are the `when` timestamps from drizzle/meta/_journal.json.
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
	"id" serial PRIMARY KEY,
	"hash" text NOT NULL,
	"created_at" bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
SELECT h, c FROM (VALUES
	('ec5d2f4e3c0f5b12728fe1e7c26b7d36a3857f81bbcf05542ce57ca90e66b71f', 1789931978694::bigint),
	('9e4aa34069fa1c1ff881f3836d5419379c08c3e24c68e5094b6afa26a1558dc3', 1789940042568::bigint)
) AS v(h, c)
WHERE NOT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "hash" = v.h);

COMMIT;
