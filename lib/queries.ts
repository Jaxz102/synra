import { count, desc, eq, gte, notInArray, sum } from "drizzle-orm"
import { cacheLife } from "next/cache"

import {
  filings,
  getDb,
  insiders,
  kvGet,
  pollRuns,
  stocks,
  trades,
  type FilingRow,
  type FilingStatus,
  type PollRunRow,
  type TradeRow,
} from "@/lib/db"
import {
  CURSOR_KEY,
  currentRun,
  DATA_VERSION_KEY,
  LAST_RUN_KEY,
} from "@/lib/pipeline/poll"

/*
 * Read models for the dashboard. Timestamps are ISO strings so rows can be handed straight to client components.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/** A trade row as the signals table and dialog header need it; the heavy JSON lives in {@link TradeDetail}. */
export interface Trade extends Pick<
  TradeRow,
  | "id"
  | "shares"
  | "pricePerShare"
  | "totalValue"
  | "tradeDate"
  | "filingDate"
  | "sharesAfter"
  | "classification"
  | "reasoning"
  | "patternSummary"
  | "classifier"
  | "filingUrl"
  | "marketCap"
  | "quotePrice"
  | "alpacaOrderId"
  | "alpacaOrderStatus"
  | "alpacaOrderLimitPrice"
  | "alpacaOrderError"
  | "alpacaFilledQty"
  | "alpacaFilledAvgPrice"
> {
  postedAt: string
  ticker: string | null
  issuerName: string
  insiderName: string
  insiderRole: string | null
}

export async function listTrades(limit = 200): Promise<Trade[]> {
  const rows = await getDb()
    .select({
      id: trades.id,
      shares: trades.shares,
      pricePerShare: trades.pricePerShare,
      totalValue: trades.totalValue,
      tradeDate: trades.tradeDate,
      filingDate: trades.filingDate,
      sharesAfter: trades.sharesAfter,
      classification: trades.classification,
      reasoning: trades.reasoning,
      patternSummary: trades.patternSummary,
      classifier: trades.classifier,
      filingUrl: trades.filingUrl,
      marketCap: trades.marketCap,
      quotePrice: trades.quotePrice,
      alpacaOrderId: trades.alpacaOrderId,
      alpacaOrderStatus: trades.alpacaOrderStatus,
      alpacaOrderLimitPrice: trades.alpacaOrderLimitPrice,
      alpacaOrderError: trades.alpacaOrderError,
      alpacaFilledQty: trades.alpacaFilledQty,
      alpacaFilledAvgPrice: trades.alpacaFilledAvgPrice,
      postedAt: trades.postedAt,
      ticker: stocks.ticker,
      issuerName: stocks.companyName,
      insiderName: insiders.name,
      insiderTitle: insiders.title,
      insiderRelationship: insiders.relationship,
    })
    .from(trades)
    .innerJoin(stocks, eq(stocks.id, trades.stockId))
    .innerJoin(insiders, eq(insiders.id, trades.insiderId))
    .orderBy(desc(trades.postedAt), desc(trades.id))
    .limit(limit)
  return rows.map(({ insiderTitle, insiderRelationship, ...t }) => ({
    ...t,
    postedAt: t.postedAt.toISOString(),
    insiderRole: insiderTitle ?? insiderRelationship,
  }))
}

/** The trade dialog's transaction table, footnote review and the insider's prior trades, loaded when the dialog opens. */
export type TradeDetail = Pick<
  TradeRow,
  "transactions" | "history" | "footnoteReview"
>

/**
 * Posted trades never change after their fill, so the detail is cached per accession. `remote` keeps one entry shared
 * by every serverless instance; the default in-memory handler would rarely hit on Vercel.
 */
export async function getTradeDetail(id: string): Promise<TradeDetail | null> {
  "use cache: remote"
  cacheLife("days")
  const [row] = await getDb()
    .select({
      transactions: trades.transactions,
      history: trades.history,
      footnoteReview: trades.footnoteReview,
    })
    .from(trades)
    .where(eq(trades.id, id))
  return row ?? null
}

export interface Filing extends Omit<
  FilingRow,
  "feedUpdated" | "processedAt" | "xmlUrl" | "form" | "footnoteReview"
> {
  feedUpdated: string
  processedAt: string | null
}

export async function listFilings(limit = 300): Promise<Filing[]> {
  const rows = await getDb()
    .select({
      accession: filings.accession,
      cik: filings.cik,
      issuerCik: filings.issuerCik,
      issuerName: filings.issuerName,
      ticker: filings.ticker,
      insiderCik: filings.insiderCik,
      insiderName: filings.insiderName,
      insiderRole: filings.insiderRole,
      feedUpdated: filings.feedUpdated,
      filedDate: filings.filedDate,
      periodOfReport: filings.periodOfReport,
      status: filings.status,
      reason: filings.reason,
      runId: filings.runId,
      attempts: filings.attempts,
      processedAt: filings.processedAt,
      indexUrl: filings.indexUrl,
    })
    .from(filings)
    .orderBy(desc(filings.feedUpdated), desc(filings.accession))
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    feedUpdated: r.feedUpdated.toISOString(),
    processedAt: iso(r.processedAt),
  }))
}

export interface Run extends Omit<PollRunRow, "startedAt" | "finishedAt"> {
  startedAt: string
  finishedAt: string | null
}

const toRun = (r: PollRunRow): Run => ({
  ...r,
  startedAt: r.startedAt.toISOString(),
  finishedAt: iso(r.finishedAt),
})

export async function listRuns(limit = 50): Promise<Run[]> {
  const rows = await getDb()
    .select()
    .from(pollRuns)
    .orderBy(desc(pollRuns.id))
    .limit(limit)
  return rows.map(toRun)
}

export interface Stats {
  signals: number
  signals24h: number
  signalValue24h: number
  scanned: number
  scanned24h: number
  planned: number
  relationship: number
  sells: number
  notPurchase: number
  penny: number
  routine: number
  history: number
  price: number
  marketCap: number
  listing: number
  footnotes: number
  order: number
  errors: number
  pending: number
}

export async function getStats(): Promise<Stats> {
  const db = getDb()
  const since = new Date(Date.now() - 86_400_000)
  const open: FilingStatus[] = ["queued", "processing"]
  const [byStatusRows, [scanned], [scanned24h], [signals], [s24]] =
    await Promise.all([
      db
        .select({ status: filings.status, n: count() })
        .from(filings)
        .groupBy(filings.status),
      db
        .select({ n: count() })
        .from(filings)
        .where(notInArray(filings.status, open)),
      db
        .select({ n: count() })
        .from(filings)
        .where(gte(filings.processedAt, since)),
      db.select({ n: count() }).from(trades),
      db
        .select({ n: count(), v: sum(trades.totalValue) })
        .from(trades)
        .where(gte(trades.postedAt, since)),
    ])
  const byStatus = new Map(byStatusRows.map((r) => [r.status, r.n]))
  return {
    signals: signals.n,
    signals24h: s24.n,
    signalValue24h: Number(s24.v ?? 0),
    scanned: scanned.n,
    scanned24h: scanned24h.n,
    planned: byStatus.get("skipped_10b5_1") ?? 0,
    relationship: byStatus.get("skipped_relationship") ?? 0,
    sells: byStatus.get("skipped_sell") ?? 0,
    notPurchase: byStatus.get("skipped_not_purchase") ?? 0,
    penny: byStatus.get("skipped_penny") ?? 0,
    routine: byStatus.get("skipped_routine") ?? 0,
    history: byStatus.get("skipped_history") ?? 0,
    price: byStatus.get("skipped_price") ?? 0,
    marketCap: byStatus.get("skipped_market_cap") ?? 0,
    listing: byStatus.get("skipped_listing") ?? 0,
    footnotes: byStatus.get("skipped_footnotes") ?? 0,
    order: byStatus.get("skipped_order") ?? 0,
    errors: byStatus.get("error") ?? 0,
    pending: (byStatus.get("queued") ?? 0) + (byStatus.get("processing") ?? 0),
  }
}

export interface PollStatus {
  running: { runId: number; startedAt: string } | null
  /** The dashboard data version (see {@link getDashboard}). */
  version: string
  lastRunStartedAt: string | null
  lastRun: Run | null
  cursor: string | null
}

export async function getPollStatus(): Promise<PollStatus> {
  const [lastRunStartedAt, cursor, version, [lastRun]] = await Promise.all([
    kvGet(LAST_RUN_KEY),
    kvGet(CURSOR_KEY),
    kvGet(DATA_VERSION_KEY),
    listRuns(1),
  ])
  // On Vercel the run lives in another invocation, so fall back to a recent run row still marked "running".
  const recent =
    lastRun?.status === "running" &&
    Date.now() - Date.parse(lastRun.startedAt) < 15 * 60_000
  return {
    running:
      currentRun() ??
      (recent ? { runId: lastRun.id, startedAt: lastRun.startedAt } : null),
    version: version ?? "0",
    lastRunStartedAt,
    lastRun: lastRun ?? null,
    cursor,
  }
}

export interface Dashboard {
  stats: Stats
  trades: Trade[]
  filings: Filing[]
  runs: Run[]
}

/**
 * The dashboard tables, cached by data version: the poll bumps `kv.dashboard_version` when it posts a trade or ends a
 * run, so a new version is a cache miss and every viewer shares one read per version (`remote` shares the entry across
 * serverless instances). The hourly revalidate catches writes that don't bump it (e.g. closeStaleRuns).
 */
export async function getDashboard(version: string): Promise<Dashboard> {
  "use cache: remote"
  cacheLife("hours")
  void version // only the cache key
  const [stats, trades, filings, runs] = await Promise.all([
    getStats(),
    listTrades(),
    listFilings(),
    listRuns(),
  ])
  return { stats, trades, filings, runs }
}
