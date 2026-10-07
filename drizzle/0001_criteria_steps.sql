ALTER TABLE "filings" ADD COLUMN "footnote_review" jsonb;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_penny" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_runs" ADD COLUMN "skipped_footnotes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "footnote_review" jsonb;