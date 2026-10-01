ALTER TABLE "poll_runs" ADD COLUMN "skipped_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "deferred" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_filled_qty" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_filled_avg_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_filled_at" timestamp with time zone;