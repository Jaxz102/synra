ALTER TABLE "insiders" ADD COLUMN "trader_evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "insiders" DROP COLUMN "trader_criteria";