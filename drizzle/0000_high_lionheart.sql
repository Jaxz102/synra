CREATE TABLE "filings" (
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
--> statement-breakpoint
CREATE TABLE "form4_cache" (
	"accession" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_analyses" (
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
--> statement-breakpoint
CREATE TABLE "insiders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"relationship" text,
	"company" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_cache" (
	"cik" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_runs" (
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
--> statement-breakpoint
CREATE TABLE "stocks" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text,
	"company_name" text NOT NULL,
	"exchange" text,
	"sector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_run_id_poll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."poll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_insider_id_insiders_id_fk" FOREIGN KEY ("insider_id") REFERENCES "public"."insiders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filings_status_idx" ON "filings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "filings_feed_updated_idx" ON "filings" USING btree ("feed_updated" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "insider_analyses_accession_idx" ON "insider_analyses" USING btree ("accession");--> statement-breakpoint
CREATE INDEX "stocks_ticker_idx" ON "stocks" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "trades_stock_id_idx" ON "trades" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "trades_insider_id_idx" ON "trades" USING btree ("insider_id");--> statement-breakpoint
CREATE INDEX "trades_trade_date_idx" ON "trades" USING btree ("trade_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_posted_at_idx" ON "trades" USING btree ("posted_at" DESC NULLS LAST);