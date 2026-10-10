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

import type { FootnoteReview } from "@/lib/pipeline/footnotes"
import type {
  HistoryTrade,
  InsiderEvaluation,
  InsiderVerdict,
} from "@/lib/pipeline/insider-criteria"
import type { Form4 } from "@/lib/sec/form4"
import type { IssuerProfile } from "@/lib/sec/issuer"

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}


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
  traderType: text().$type<InsiderVerdict>(),
  traderEvaluation: jsonb().$type<InsiderEvaluation>(),
  traderClassifiedAt: timestamp({ withTimezone: true }),
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
  trades?: HistoryTrade[]
}

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
    postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sharesAfter: doublePrecision(),
    transactions: jsonb().$type<TradeTransaction[]>().notNull(),
    classification: text(),
    reasoning: text(),
    patternSummary: text(),
    classifier: text(),
    history: jsonb().$type<TradeHistory>(),
    filingUrl: text(),
    marketCap: doublePrecision(),
    quotePrice: numeric({ precision: 18, scale: 4, mode: "number" }),
    footnoteReview: jsonb().$type<FootnoteReview>(),
    alpacaOrderId: text(),
    alpacaClientOrderId: text(),
    alpacaOrderStatus: text(),
    alpacaOrderNotional: numeric({ precision: 18, scale: 2, mode: "number" }),
    alpacaOrderQty: doublePrecision(),
    alpacaOrderLimitPrice: numeric({ precision: 18, scale: 4, mode: "number" }),
    alpacaOrderError: text(),
    alpacaOrderedAt: timestamp({ withTimezone: true }),
    alpacaFilledQty: doublePrecision(),
    alpacaFilledAvgPrice: numeric({ precision: 18, scale: 4, mode: "number" }),
    alpacaFilledAt: timestamp({ withTimezone: true }),
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
  skippedRelationship: integer().notNull().default(0),
  skippedSell: integer().notNull().default(0),
  skippedPenny: integer().notNull().default(0),
  skippedNotPurchase: integer().notNull().default(0),
  skippedListing: integer().notNull().default(0),
  skippedRoutine: integer().notNull().default(0),
  skippedHistory: integer().notNull().default(0),
  skippedMarketCap: integer().notNull().default(0),
  skippedPrice: integer().notNull().default(0),
  skippedFootnotes: integer().notNull().default(0),
  skippedOrder: integer().notNull().default(0),
  deferred: integer().notNull().default(0),
  posted: integer().notNull().default(0),
  errors: integer().notNull().default(0),
  error: text(),
})

export type FilingStatus =
  | "queued"
  | "processing"
  | "skipped_sell"
  | "skipped_not_purchase"
  | "skipped_10b5_1"
  | "skipped_relationship"
  | "skipped_penny"
  | "skipped_routine"
  | "skipped_history"
  | "skipped_price"
  | "skipped_market_cap"
  | "skipped_listing"
  | "skipped_footnotes"
  | "skipped_order"
  | "posted"
  | "error"

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
    footnoteReview: jsonb().$type<FootnoteReview>(),
  },
  (t) => [
    index("filings_status_idx").on(t.status),
    index("filings_feed_updated_idx").on(t.feedUpdated.desc()),
  ]
)

export const insiderAnalyses = pgTable(
  "insider_analyses",
  {
    id: serial().primaryKey(),
    accession: text().notNull(),
    insiderCik: text().notNull(),
    issuerCik: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    classifier: text().notNull(),
    classification: text().notNull(),
    reasoning: text(),
    patternSummary: text(),
    history: jsonb().$type<TradeHistory>(),
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
