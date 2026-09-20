import { count, desc, eq, gte, notInArray, sum } from "drizzle-orm"

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
  type InsiderRow,
  type PollRunRow,
  type StockRow,
  type TradeRow,
} from "@/lib/db"
import { env } from "@/lib/env"
import { CURSOR_KEY, currentRun, LAST_RUN_KEY } from "@/lib/pipeline/poll"
import { intervalMs, nextScheduledRunAt } from "@/lib/pipeline/scheduler"

/*
 * Read models for the dashboard. Timestamps are ISO strings so rows can be handed straight to client components.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export interface Trade extends Omit<
  TradeRow,
  "postedAt" | "createdAt" | "updatedAt"
> {
  postedAt: string
  ticker: string | null
  issuerName: string
  insiderName: string
  insiderRole: string | null
}

export async function listTrades(limit = 200): Promise<Trade[]> {
  const rows = await getDb()
    .select({ trade: trades, stock: stocks, insider: insiders })
    .from(trades)
    .innerJoin(stocks, eq(stocks.id, trades.stockId))
    .innerJoin(insiders, eq(insiders.id, trades.insiderId))
    .orderBy(desc(trades.postedAt), desc(trades.id))
    .limit(limit)
  return rows.map(
    ({
      trade,
      stock,
      insider,
    }: {
      trade: TradeRow
      stock: StockRow
      insider: InsiderRow
    }) => {
      const { createdAt, updatedAt, ...t } = trade
      void createdAt
      void updatedAt
      return {
        ...t,
        postedAt: trade.postedAt.toISOString(),
        ticker: stock.ticker,
        issuerName: stock.companyName,
        insiderName: insider.name,
        insiderRole: insider.title ?? insider.relationship,
      }
    }
  )
}

export interface Filing extends Omit<
  FilingRow,
  "feedUpdated" | "processedAt" | "xmlUrl" | "form"
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
  sells: number
  notPurchase: number
  routine: number
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
    sells: byStatus.get("skipped_sell") ?? 0,
    notPurchase: byStatus.get("skipped_not_purchase") ?? 0,
    routine: byStatus.get("skipped_routine") ?? 0,
    errors: byStatus.get("error") ?? 0,
    pending: (byStatus.get("queued") ?? 0) + (byStatus.get("processing") ?? 0),
  }
}

export interface PollStatus {
  running: { runId: number; startedAt: string } | null
  lastRunStartedAt: string | null
  lastRun: Run | null
  cursor: string | null
  nextRunAt: string | null
  intervalHours: number
  schedulerEnabled: boolean
  model: string
}

export async function getPollStatus(): Promise<PollStatus> {
  const next = nextScheduledRunAt()
  const [lastRunStartedAt, cursor, [lastRun]] = await Promise.all([
    kvGet(LAST_RUN_KEY),
    kvGet(CURSOR_KEY),
    listRuns(1),
  ])
  return {
    running: currentRun(),
    lastRunStartedAt,
    lastRun: lastRun ?? null,
    cursor,
    nextRunAt: next ? new Date(next).toISOString() : null,
    intervalHours: intervalMs() / 3_600_000,
    schedulerEnabled: env.schedulerEnabled,
    model: env.xaiModel,
  }
}
