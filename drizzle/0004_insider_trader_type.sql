ALTER TABLE "insiders" ADD COLUMN "trader_type" text;--> statement-breakpoint
ALTER TABLE "insiders" ADD COLUMN "trader_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "insiders" ADD COLUMN "trader_classified_at" timestamp with time zone;