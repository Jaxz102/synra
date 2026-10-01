ALTER TABLE "insider_analyses" RENAME COLUMN "model" TO "classifier";--> statement-breakpoint
ALTER TABLE "trades" RENAME COLUMN "ai_classification" TO "classification";--> statement-breakpoint
ALTER TABLE "trades" RENAME COLUMN "ai_reasoning" TO "reasoning";--> statement-breakpoint
ALTER TABLE "trades" RENAME COLUMN "ai_pattern" TO "pattern_summary";--> statement-breakpoint
ALTER TABLE "trades" RENAME COLUMN "ai_model" TO "classifier";--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_listing" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_history" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_market_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "market_cap" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "quote_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_order_limit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "insider_analyses" DROP COLUMN "confidence";--> statement-breakpoint
ALTER TABLE "insider_analyses" DROP COLUMN "prompt_tokens";--> statement-breakpoint
ALTER TABLE "insider_analyses" DROP COLUMN "completion_tokens";--> statement-breakpoint
ALTER TABLE "trades" DROP COLUMN "ai_confidence";