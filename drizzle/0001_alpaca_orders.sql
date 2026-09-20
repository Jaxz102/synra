ALTER TABLE "trades" ADD COLUMN "alpaca_order_id" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_client_order_id" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_order_status" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_order_notional" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_order_qty" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_order_error" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "alpaca_ordered_at" timestamp with time zone;