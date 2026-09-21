import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import type { HistoryRow, HistoryStats } from "@/lib/ai/classify"
import type { Form4 } from "@/lib/sec/form4"
import type { IssuerProfile } from "@/lib/sec/issuer"

// Column names are derived from the property names via `casing: "snake_case"` (see lib/db/index.ts and drizzle.config.ts).
// Ids are SEC identifiers: stocks.id = issuer CIK, insiders.id = reporting-owner CIK, trades.id = accession number.

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}

/* ---------- Eraser ERD "Insider Trade Tracking" ---------- */

export const stocks = pgTable(
  "stocks",
  {
    id: text().primaryKey(),
    ticker: text(),
    companyName: text().notNull(),
    exchange: text(),
    sector: text(),
    ...timestamps,
  },
  (t) => [index("stocks_ticker_idx").on(t.ticker)]
)

export const insiders = pgTable("insiders", {
  id: text().primaryKey(),
  name: text().notNull(),
  title: text(),
  relationship: text(),
  company: text(),
  ...timestamps,
})

export interface TradeTransaction {
  date: string | null
  securityTitle: string
  shares: number | null
  pricePerShare: number | null
  sharesAfter: number | null
  ownership: "D" | "I" | null
  natureOfOwnership: string | null
  footnotes: string[]
}

export interface TradeHistory {
  stats: HistoryStats
  filings: HistoryRow[]
}

/** A posted signal: an unplanned open-market purchase that Grok judged opportunistic. */
export const trades = pgTable(
  "trades",
  {
    id: text().primaryKey(),
    insiderId: text()
      .notNull()
      .references(() => insiders.id),
    stockId: text()
      .notNull()
      .references(() => stocks.id),
    tradeType: text().notNull(),
    shares: bigint({ mode: "number" }).notNull(),
    pricePerShare: numeric({ precision: 18, scale: 4, mode: "number" }),
    totalValue: numeric({ precision: 18, scale: 2, mode: "number" }),
    tradeDate: text(),
    filingDate: text(),
    // Dashboard detail beyond the ERD.
    postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sharesAfter: doublePrecision(),
    transactions: jsonb().$type<TradeTransaction[]>().notNull(),
    aiClassification: text(),
    aiConfidence: doublePrecision(),
    aiReasoning: text(),
    aiPattern: text(),
    aiModel: text(),
    history: jsonb().$type<TradeHistory>(),
    filingUrl: text(),
    // Alpaca paper order placed when the trade was posted (see lib/alpaca/client.ts).
    alpacaOrderId: text(),
    alpacaClientOrderId: text(),
    alpacaOrderStatus: text(),
    alpacaOrderNotional: numeric({ precision: 18, scale: 2, mode: "number" }),
    alpacaOrderQty: doublePrecision(),
    alpacaOrderError: text(),
    alpacaOrderedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("trades_stock_id_idx").on(t.stockId),
    index("trades_insider_id_idx").on(t.insiderId),
    index("trades_trade_date_idx").on(t.tradeDate.desc()),
    index("trades_posted_at_idx").on(t.postedAt.desc()),
  ]
)

/* ---------- Pipeline state ---------- */

export const kv = pgTable("kv", {
  key: text().primaryKey(),
  value: text().notNull(),
})

export const pollRuns = pgTable("poll_runs", {
  id: serial().primaryKey(),
  trigger: text().$type<"schedule" | "manual" | "cli">().notNull(),
  status: text().$type<"running" | "success" | "error">().notNull(),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  finishedAt: timestamp({ withTimezone: true }),
  cursorBefore: text(),
  cursorAfter: text(),
  feedEntries: integer().notNull().default(0),
  newFilings: integer().notNull().default(0),
  skipped10b51: integer("skipped_10b5_1").notNull().default(0),
  skippedSell: integer().notNull().default(0),
  skippedNotPurchase: integer().notNull().default(0),
  skippedRoutine: integer().notNull().default(0),
  posted: integer().notNull().default(0),
  errors: integer().notNull().default(0),
  error: text(),
})

export type FilingStatus =
  | "queued"
  | "processing"
  | "skipped_10b5_1"
  | "skipped_sell"
  | "skipped_not_purchase"
  | "skipped_routine"
  | "posted"
  | "error"

/** Every Form 4 seen in the feed and what the pipeline decided about it. */
export const filings = pgTable(
  "filings",
  {
    accession: text().primaryKey(),
    cik: text().notNull(),
    issuerCik: text(),
    issuerName: text(),
    ticker: text(),
    insiderCik: text(),
    insiderName: text(),
    insiderRole: text(),
    feedUpdated: timestamp({ withTimezone: true }).notNull(),
    filedDate: text(),
    periodOfReport: text(),
    status: text().$type<FilingStatus>().notNull(),
    reason: text(),
    runId: integer().references(() => pollRuns.id),
    attempts: integer().notNull().default(0),
    processedAt: timestamp({ withTimezone: true }),
    indexUrl: text(),
    xmlUrl: text(),
    form: jsonb().$type<Form4>(),
  },
  (t) => [
    index("filings_status_idx").on(t.status),
    index("filings_feed_updated_idx").on(t.feedUpdated.desc()),
  ]
)

/** One row per Grok classification, including the routine ones that never became a trade. */
export const insiderAnalyses = pgTable(
  "insider_analyses",
  {
    id: serial().primaryKey(),
    accession: text().notNull(),
    insiderCik: text().notNull(),
    issuerCik: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    model: text().notNull(),
    classification: text().notNull(),
    confidence: doublePrecision(),
    reasoning: text(),
    patternSummary: text(),
    history: jsonb().$type<TradeHistory>(),
    promptTokens: integer(),
    completionTokens: integer(),
  },
  (t) => [index("insider_analyses_accession_idx").on(t.accession)]
)

/* ---------- SEC response caches ---------- */

export const form4Cache = pgTable("form4_cache", {
  accession: text().primaryKey(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  form: jsonb().$type<Form4>().notNull(),
})

export const issuerCache = pgTable("issuer_cache", {
  cik: text().primaryKey(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  profile: jsonb().$type<IssuerProfile>().notNull(),
})

export type StockRow = typeof stocks.$inferSelect
export type InsiderRow = typeof insiders.$inferSelect
export type TradeRow = typeof trades.$inferSelect
export type PollRunRow = typeof pollRuns.$inferSelect
export type FilingRow = typeof filings.$inferSelect
