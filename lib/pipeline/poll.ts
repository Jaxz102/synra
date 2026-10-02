import { and, eq, inArray, lt, sql } from "drizzle-orm"

import {
  AlpacaError,
  alpacaConfigured,
  cancelOrder,
  findOrderByClientId,
  getAsset,
  getClock,
  getLatestTrade,
  getOrder,
  getOrderByClientId,
  placeMarketBuy,
  type AlpacaAsset,
  type AlpacaOrder,
} from "@/lib/alpaca/client"
import {
  filings,
  getDb,
  keep,
  kvGet,
  kvSet,
  now,
  pollRuns,
  stocks,
  trades,
  type FilingStatus,
} from "@/lib/db"
import { env } from "@/lib/env"
import { getMarketCap } from "@/lib/finnhub/client"
import { fmtMoney, fmtMoneyCompact } from "@/lib/format"
import {
  CLASSIFIER,
  type InsiderEvaluation,
} from "@/lib/pipeline/insider-criteria"
import {
  insiderRow,
  insiderVerdict,
  upsertInsider,
} from "@/lib/pipeline/insiders"
import { cikPadded, filingIndexHtmlUrl } from "@/lib/sec/client"
import { fetchFeedDelta, type FeedFiling } from "@/lib/sec/feed"
import {
  describeRole,
  fetchForm4,
  type Form4,
  isCommonStock,
  openMarketPurchases,
  summarizeTrade,
  type TradeSummary,
} from "@/lib/sec/form4"
import { cacheForm4 } from "@/lib/sec/insider"
import { getIssuerProfile } from "@/lib/sec/issuer"

export type { FilingStatus }

export const CURSOR_KEY = "feed_cursor_updated"
export const LAST_RUN_KEY = "last_run_started_at"

export type PollTrigger = "schedule" | "manual" | "cli"

/** Keys match the `skipped_*` filing statuses so a status can bump its own counter. */
export interface RunCounters {
  feed_entries: number
  new_filings: number
  skipped_sell: number
  skipped_not_purchase: number
  skipped_10b5_1: number
  skipped_listing: number
  skipped_routine: number
  skipped_market_cap: number
  skipped_price: number
  skipped_order: number
  deferred: number
  posted: number
  errors: number
}

export interface PollOptions {
  /** Process at most this many new filings (useful for smoke tests). */
  limit?: number
  /** Override the lookback used when no cursor exists yet. */
  lookbackHours?: number
  /** Epoch ms after which no further filing is started; the rest stay queued for the next run. */
  deadline?: number
  log?: (msg: string) => void
}

type G = typeof globalThis & {
  __synraPollLock?: { runId: number; startedAt: string } | null
}

export function currentRun(): { runId: number; startedAt: string } | null {
  return (globalThis as G).__synraPollLock ?? null
}

function setLock(v: { runId: number; startedAt: string } | null) {
  ;(globalThis as G).__synraPollLock = v
}

const MAX_ATTEMPTS = 3
/** A run still "running" after this long was cut off (e.g. a serverless timeout) and is closed out as an error. */
const STALE_RUN_MS = 15 * 60_000

/* Screening thresholds from the "SEC Filtering Pipeline" Linear doc. */
const LISTED_EXCHANGES = ["NYSE", "NASDAQ"]
const MIN_MARKET_CAP = 100_000_000
/** Step 6 fails when the stock now trades more than this fraction above the filing's purchase price. */
const MAX_PRICE_PREMIUM = 0.02
/** How long step 7 waits for a market buy to fill before cancelling it. */
const FILL_TIMEOUT_MS = 30_000
/** Order statuses Alpaca will not move on from (https://docs.alpaca.markets/docs/orders-at-alpaca). */
const FINAL_ORDER_STATUSES = new Set([
  "filled",
  "canceled",
  "expired",
  "rejected",
  "done_for_day",
  "replaced",
  "stopped",
  "suspended",
])

async function upsertFiling(f: FeedFiling, runId: number) {
  await getDb()
    .insert(filings)
    .values({
      accession: f.accession,
      cik: f.pathCik,
      issuerCik: f.issuerCik,
      issuerName: f.issuerName,
      insiderCik: f.reportingCiks[0] ?? null,
      insiderName: f.reportingNames[0] ?? null,
      feedUpdated: new Date(f.updated),
      filedDate: f.filedDate,
      status: "queued",
      runId,
      indexUrl: filingIndexHtmlUrl(f.pathCik, f.accession),
    })
    .onConflictDoNothing()
}

async function finishFiling(
  accession: string,
  status: FilingStatus,
  reason: string | null,
  form: Form4 | null,
  runId: number,
  /** False when the filing is only deferred, so waiting for the market does not use up its retries. */
  countAttempt = true
) {
  const owner = form?.owners[0]
  await getDb()
    .update(filings)
    .set({
      status,
      reason,
      processedAt: new Date(),
      runId,
      attempts: countAttempt
        ? sql`${filings.attempts} + 1`
        : sql`${filings.attempts}`,
      issuerCik: keep(filings.issuerCik, form?.issuer.cik),
      issuerName: keep(filings.issuerName, form?.issuer.name),
      ticker: keep(filings.ticker, form?.issuer.ticker),
      insiderCik: keep(filings.insiderCik, owner?.cik),
      insiderName: keep(filings.insiderName, owner?.name),
      insiderRole: keep(filings.insiderRole, form ? describeRole(owner) : null),
      periodOfReport: keep(filings.periodOfReport, form?.periodOfReport),
      xmlUrl: keep(filings.xmlUrl, form?.xmlUrl),
      form: form ?? sql`${filings.form}`,
    })
    .where(eq(filings.accession, accession))
}

/** Writes the filled buy as stock + insider + trade rows (the Eraser ERD) in one transaction. */
async function postTrade(
  form: Form4,
  trade: TradeSummary,
  insider: InsiderEvaluation,
  asset: AlpacaAsset,
  screen: { marketCap: number; quotePrice: number | null },
  filedDate: string | null,
  order: AlpacaOrder
) {
  const row = insiderRow(form)
  const stockId = cikPadded(form.issuer.cik)
  let sector: string | null = null
  try {
    sector = (await getIssuerProfile(stockId)).sicDescription
  } catch (err) {
    console.warn(
      `[synra] issuer profile unavailable for ${stockId}: ${(err as Error).message}`
    )
  }
  const tradeRow = {
    insiderId: row.id,
    stockId,
    tradeType: "purchase",
    shares: Math.round(trade.shares),
    pricePerShare:
      trade.avgPrice === null ? null : Number(trade.avgPrice.toFixed(4)),
    totalValue: trade.value === null ? null : Number(trade.value.toFixed(2)),
    tradeDate: trade.date ?? form.periodOfReport ?? null,
    filingDate: filedDate ?? form.signatureDate ?? null,
    postedAt: new Date(),
    sharesAfter: trade.sharesAfter,
    transactions: trade.transactions.map((t) => ({
      ...t,
      footnotes: t.footnoteIds.map((id) => form.footnotes[id]).filter(Boolean),
    })),
    classification: insider.verdict,
    patternSummary: insider.summary,
    classifier: CLASSIFIER,
    history: { trades: insider.trades },
    filingUrl: form.indexUrl,
    marketCap: screen.marketCap,
    quotePrice: screen.quotePrice,
    alpacaOrderId: order.id,
    alpacaClientOrderId: order.client_order_id,
    alpacaOrderStatus: order.status,
    alpacaOrderNotional: order.notional ? Number(order.notional) : null,
    alpacaOrderQty: order.qty ? Number(order.qty) : null,
    alpacaOrderedAt: new Date(order.submitted_at ?? order.created_at),
    alpacaFilledQty: Number(order.filled_qty),
    alpacaFilledAvgPrice: order.filled_avg_price
      ? Number(order.filled_avg_price)
      : null,
    alpacaFilledAt: order.filled_at ? new Date(order.filled_at) : null,
  }

  await getDb().transaction(async (tx) => {
    await tx
      .insert(stocks)
      .values({
        id: stockId,
        ticker: asset.symbol,
        companyName: form.issuer.name ?? stockId,
        exchange: asset.exchange,
        sector,
      })
      .onConflictDoUpdate({
        target: stocks.id,
        set: {
          ticker: asset.symbol,
          companyName: form.issuer.name ?? stockId,
          exchange: asset.exchange,
          sector: keep(stocks.sector, sector),
          updatedAt: now,
        },
      })
    await upsertInsider(tx, row)
    await tx
      .insert(trades)
      .values({ id: form.accession, ...tradeRow })
      .onConflictDoUpdate({
        target: trades.id,
        set: { ...tradeRow, updatedAt: now },
      })
  })
}

/**
 * Step 7: a day market buy of $ALPACA_ORDER_NOTIONAL. The accession number doubles as Alpaca's client_order_id,
 * so a filing can never be bought twice. Returns null when Alpaca refuses the order (not fractionable and too
 * expensive for one share, insufficient buying power, …), which is final for the filing.
 */
async function placeBuy(
  accession: string,
  asset: AlpacaAsset,
  price: number
): Promise<AlpacaOrder | { refused: string }> {
  try {
    return await placeMarketBuy({
      asset,
      notional: env.alpacaOrderNotional,
      price,
      clientOrderId: accession,
    })
  } catch (err) {
    if (!(err instanceof AlpacaError)) throw err
    // 42210000 "client_order_id must be unique": an earlier attempt got through but we lost the response.
    if (
      err.code === 42210000 ||
      /client_order_id must be unique/i.test(err.message)
    )
      return getOrderByClientId(accession)
    if (err.status >= 400 && err.status < 500 && err.status !== 429)
      return { refused: err.message }
    throw err
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Waits for the order to reach a final status; cancels it after FILL_TIMEOUT_MS so nothing fills later unseen. */
async function awaitFill(
  order: AlpacaOrder,
  log: (m: string) => void
): Promise<AlpacaOrder> {
  let until = Date.now() + FILL_TIMEOUT_MS
  let cancelled = false
  while (!FINAL_ORDER_STATUSES.has(order.status)) {
    if (Date.now() >= until) {
      if (cancelled) break
      log(
        `  alpaca: ${order.symbol} not filled after ${FILL_TIMEOUT_MS / 1000}s, cancelling`
      )
      await cancelOrder(order.id).catch((err) =>
        log(`  alpaca: cancel ${order.id} failed: ${(err as Error).message}`)
      )
      cancelled = true
      until = Date.now() + 10_000
    }
    await sleep(1_000)
    order = await getOrder(order.id)
  }
  return order
}

/** Form 4 symbols come as "BRK-B", "brk/b", "GOOG, GOOGL" or "NONE"; Alpaca spells class shares "BRK.B". */
function tickerCandidates(raw: string | null): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t && !["NONE", "N/A", "NA"].includes(t))
    .map((t) => t.replace(/[-/]/g, "."))
}

async function findAsset(ticker: string | null): Promise<AlpacaAsset | null> {
  for (const symbol of tickerCandidates(ticker)) {
    try {
      return await getAsset(symbol)
    } catch (err) {
      if (!(err instanceof AlpacaError && err.status === 404)) throw err
    }
  }
  return null
}

const fmtPremium = (p: number) => `${p >= 0 ? "+" : ""}${(p * 100).toFixed(1)}%`

/**
 * Runs the screening steps of the "SEC Filtering Pipeline" Linear doc in order. The first step a filing fails is
 * recorded as its status; a filing that passes steps 1-6 is bought (step 7) and posted once the buy fills.
 * Filings that pass steps 1-5 while the market is closed stay queued ("deferred") for a later run.
 */
async function evaluateFiling(
  f: FeedFiling,
  runId: number,
  log: (m: string) => void,
  marketOpen: () => Promise<boolean>
): Promise<FilingStatus | "deferred"> {
  const form = await fetchForm4(f.pathCik, f.accession)
  await cacheForm4(form)
  const label = `${form.issuer.ticker ?? form.issuer.name} / ${form.owners[0]?.name ?? "?"} (${f.accession})`
  const skip = async (status: FilingStatus, reason: string) => {
    await finishFiling(f.accession, status, reason, form, runId)
    if (status !== "skipped_not_purchase") log(`  ${reason} → skip ${label}`)
    return status
  }

  if (form.documentType !== "4")
    return skip("skipped_not_purchase", `Document type ${form.documentType}`)

  // Step 1: open-market purchases (code P) only; sales (S) and grants, exercises, gifts etc. are out.
  const buys = openMarketPurchases(form)
  if (buys.length === 0) {
    const codes = [...new Set(form.transactions.map((t) => t.code ?? "?"))]
    if (form.transactions.length === 0)
      return skip(
        "skipped_not_purchase",
        "No transactions reported (holdings only)"
      )
    const anyAcquired = form.transactions.some(
      (t) => t.acquiredDisposed === "A"
    )
    if (!anyAcquired || form.transactions.some((t) => t.code === "S"))
      return skip(
        "skipped_sell",
        `Sale/disposition only (codes ${codes.join(", ")})`
      )
    return skip(
      "skipped_not_purchase",
      `No open-market purchase (codes ${codes.join(", ")})`
    )
  }

  // Step 2: the Rule 10b5-1 checkbox must be unchecked.
  if (form.aff10b5One)
    return skip("skipped_10b5_1", "Rule 10b5-1 checkbox is checked")

  // Step 3: the security bought must be a stock listed on NYSE or Nasdaq.
  const stockBuys = buys.filter((t) => isCommonStock(t.securityTitle))
  if (stockBuys.length === 0)
    return skip(
      "skipped_listing",
      `Purchased security is not a stock (${[...new Set(buys.map((t) => t.securityTitle))].join(", ")})`
    )
  const asset = await findAsset(form.issuer.ticker)
  if (!asset)
    return skip(
      "skipped_listing",
      `Ticker "${form.issuer.ticker ?? ""}" is not listed on Alpaca`
    )
  if (asset.class !== "us_equity" || !LISTED_EXCHANGES.includes(asset.exchange))
    return skip(
      "skipped_listing",
      `${asset.symbol} trades on ${asset.exchange}, not NYSE or Nasdaq`
    )
  const trade = summarizeTrade(form, stockBuys)

  // Step 4: the insider must be an opportunistic trader (lib/pipeline/insiders.ts).
  const tradeDate = trade.date ?? f.filedDate
  if (!tradeDate) throw new Error("Filing has no trade or filing date")
  const insider = await insiderVerdict(form, tradeDate)
  if (insider.verdict === "routine")
    return skip("skipped_routine", `Routine trader: ${insider.summary}`)

  // Step 5: market capitalization of at least $100M.
  const marketCap = await getMarketCap(asset.symbol)
  if (marketCap === null)
    return skip(
      "skipped_market_cap",
      `Finnhub has no market cap for ${asset.symbol}`
    )
  if (marketCap < MIN_MARKET_CAP)
    return skip(
      "skipped_market_cap",
      `Market cap ${fmtMoneyCompact(marketCap)} is below ${fmtMoneyCompact(MIN_MARKET_CAP)}`
    )

  if (trade.avgPrice === null)
    return skip("skipped_price", "Filing reports no purchase price")

  // An earlier attempt may already have bought; pick that order up instead of screening the price again.
  let order = await findOrderByClientId(f.accession)
  let quotePrice: number | null = null
  let premium: number | null = null
  if (!order) {
    // Steps 6-7 need the market open: the price check is only meaningful if the market buy fills right after it.
    if (!(await marketOpen())) {
      await finishFiling(
        f.accession,
        "queued",
        "Passed steps 1-5 while the market was closed; retried on a later run",
        form,
        runId,
        false
      )
      log(`  market closed → deferred ${label}`)
      return "deferred"
    }

    // Step 6: the current price must be at most 2% above what the insider paid.
    let quote: Awaited<ReturnType<typeof getLatestTrade>>
    try {
      quote = await getLatestTrade(asset.symbol)
    } catch (err) {
      if (!(err instanceof AlpacaError && err.status === 404)) throw err
      return skip("skipped_price", `No current price: ${err.message}`)
    }
    quotePrice = quote.price
    premium = quote.price / trade.avgPrice - 1
    if (premium > MAX_PRICE_PREMIUM)
      return skip(
        "skipped_price",
        `Current ${fmtMoney(quote.price, 2)} is ${fmtPremium(premium)} vs the filing's ${fmtMoney(trade.avgPrice, 2)} (max +${MAX_PRICE_PREMIUM * 100}%)`
      )

    // Step 7: market buy.
    const placed = await placeBuy(f.accession, asset, quote.price)
    if ("refused" in placed)
      return skip(
        "skipped_order",
        `Alpaca refused the order: ${placed.refused}`
      )
    order = placed
  }

  // Only a filled buy becomes a trade.
  order = await awaitFill(order, log)
  const filledQty = Number(order.filled_qty ?? 0)
  if (!(filledQty > 0))
    return skip("skipped_order", `Alpaca order ${order.status} without a fill`)
  const fill = Number(order.filled_avg_price)
  log(
    `  alpaca: bought ${filledQty} ${order.symbol} @ ${fmtMoney(fill, 2)} (${order.id})`
  )
  await postTrade(
    form,
    trade,
    insider,
    asset,
    { marketCap, quotePrice },
    f.filedDate,
    order
  )
  await finishFiling(
    f.accession,
    "posted",
    `Opportunistic: ${insider.summary} Cap ${fmtMoneyCompact(marketCap)}, ${premium === null ? "" : `price ${fmtMoney(quotePrice, 2)} (${fmtPremium(premium)} vs filing), `}bought ${filledQty} @ ${fmtMoney(fill, 2)}.`,
    form,
    runId
  )
  log(
    `  POSTED ${label}: ${trade.shares.toLocaleString()} sh ≈ $${(trade.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  )
  return "posted"
}

async function requeueErrors(): Promise<FeedFiling[]> {
  const rows = await getDb()
    .select()
    .from(filings)
    .where(
      and(
        inArray(filings.status, ["error", "queued", "processing"]),
        lt(filings.attempts, MAX_ATTEMPTS)
      )
    )
    .orderBy(filings.feedUpdated)
  return rows.map((r) => ({
    accession: r.accession,
    formType: "4",
    updated: r.feedUpdated.toISOString(),
    updatedMs: r.feedUpdated.getTime(),
    filedDate: r.filedDate,
    issuerCik: r.issuerCik,
    issuerName: r.issuerName,
    reportingCiks: r.insiderCik ? [r.insiderCik] : [],
    reportingNames: r.insiderName ? [r.insiderName] : [],
    pathCik: r.cik,
    indexUrl: r.indexUrl ?? "",
  }))
}

export async function runPoll(
  trigger: PollTrigger,
  opts: PollOptions = {}
): Promise<{ runId: number; counters: RunCounters }> {
  if (currentRun()) throw new Error("A poll run is already in progress")
  const log = opts.log ?? ((m: string) => console.log(`[synra] ${m}`))
  const db = getDb()
  const started = new Date()
  const startedAt = started.toISOString()
  // Take the lock before the first await so a second trigger in the same tick is rejected.
  setLock({ runId: 0, startedAt })
  let cursorBefore: string | null
  let runId: number
  try {
    await db
      .update(pollRuns)
      .set({
        status: "error",
        error: "interrupted: the process ended before the run finished",
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(pollRuns.status, "running"),
          lt(pollRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))
        )
      )
    cursorBefore = await kvGet(CURSOR_KEY)
    ;[{ id: runId }] = await db
      .insert(pollRuns)
      .values({ trigger, status: "running", startedAt: started, cursorBefore })
      .returning({ id: pollRuns.id })
  } catch (err) {
    setLock(null)
    throw err
  }
  setLock({ runId, startedAt })
  const counters: RunCounters = {
    feed_entries: 0,
    new_filings: 0,
    skipped_sell: 0,
    skipped_not_purchase: 0,
    skipped_10b5_1: 0,
    skipped_listing: 0,
    skipped_routine: 0,
    skipped_market_cap: 0,
    skipped_price: 0,
    skipped_order: 0,
    deferred: 0,
    posted: 0,
    errors: 0,
  }
  const persist = (
    status: "running" | "success" | "error",
    error?: string,
    cursorAfter?: string | null
  ) =>
    db
      .update(pollRuns)
      .set({
        status,
        error: error ?? null,
        finishedAt: status === "running" ? null : new Date(),
        cursorAfter: keep(pollRuns.cursorAfter, cursorAfter),
        feedEntries: counters.feed_entries,
        newFilings: counters.new_filings,
        skipped10b51: counters.skipped_10b5_1,
        skippedSell: counters.skipped_sell,
        skippedNotPurchase: counters.skipped_not_purchase,
        skippedListing: counters.skipped_listing,
        skippedRoutine: counters.skipped_routine,
        skippedMarketCap: counters.skipped_market_cap,
        skippedPrice: counters.skipped_price,
        skippedOrder: counters.skipped_order,
        deferred: counters.deferred,
        posted: counters.posted,
        errors: counters.errors,
      })
      .where(eq(pollRuns.id, runId))

  try {
    // Steps 3, 5 and 6 need these; failing the run keeps the cursor put instead of burning filings' retries.
    if (!alpacaConfigured() || !env.finnhubApiKey)
      throw new Error(
        "ALPACA_KEY, ALPACA_SECRET and FINNHUB_API_KEY must be set"
      )
    await kvSet(LAST_RUN_KEY, startedAt)
    const lookbackHours = opts.lookbackHours ?? env.initialLookbackHours
    const cursorMs = cursorBefore
      ? Date.parse(cursorBefore)
      : Date.now() - lookbackHours * 3_600_000
    log(
      `run #${runId} (${trigger}) cursor=${cursorBefore ?? `none, lookback ${lookbackHours}h`}`
    )

    const delta = await fetchFeedDelta({
      cursorMs,
      maxPages: env.maxFeedPages,
      onPage: (p, n) => log(`feed page ${p}: ${n} entries`),
    })
    counters.feed_entries = delta.entriesSeen
    const retries = await requeueErrors()
    const seen = new Set(retries.map((r) => r.accession))
    const known = delta.filings.length
      ? new Set(
          (
            await db
              .select({ accession: filings.accession })
              .from(filings)
              .where(
                inArray(
                  filings.accession,
                  delta.filings.map((f) => f.accession)
                )
              )
          ).map((r) => r.accession)
        )
      : new Set<string>()
    const fresh = delta.filings.filter(
      (f) => !seen.has(f.accession) && !known.has(f.accession)
    )
    const queue = [...retries, ...fresh].slice(
      0,
      opts.limit ?? Number.POSITIVE_INFINITY
    )
    counters.new_filings = fresh.length
    log(
      `${delta.filings.length} filings in delta, ${fresh.length} new, ${retries.length} retries, processing ${queue.length}${delta.reachedCursor ? "" : " (feed paging limit reached before cursor)"}`
    )
    for (const f of fresh) await upsertFiling(f, runId)
    await persist("running")

    // Alpaca's clock, re-read at most once a minute so a long run notices the open or close.
    let clock: { open: boolean; at: number } | null = null
    const marketOpen = async () => {
      if (!clock || Date.now() - clock.at > 60_000)
        clock = { open: (await getClock()).is_open, at: Date.now() }
      return clock.open
    }

    let maxUpdated = cursorBefore ? Date.parse(cursorBefore) : 0
    let processed = 0
    for (const f of queue) {
      if (opts.deadline && Date.now() > opts.deadline) {
        log(
          `time budget reached after ${processed} filings; ${queue.length - processed} left queued`
        )
        break
      }
      await db
        .update(filings)
        .set({ status: "processing", runId })
        .where(eq(filings.accession, f.accession))
      try {
        const status = await evaluateFiling(f, runId, log, marketOpen)
        if (status === "posted") counters.posted += 1
        else if (status !== "error") counters[status as keyof RunCounters] += 1
      } catch (err) {
        counters.errors += 1
        const msg = (err as Error).message ?? String(err)
        log(`  error ${f.accession}: ${msg}`)
        await finishFiling(f.accession, "error", msg.slice(0, 500), null, runId)
      }
      if (f.updatedMs > maxUpdated) {
        maxUpdated = f.updatedMs
        await kvSet(CURSOR_KEY, new Date(maxUpdated).toISOString())
      }
      processed += 1
      if (processed % 10 === 0) await persist("running")
    }
    // If the whole delta was processed, advance the cursor to the newest entry we saw even if it was skipped.
    if (
      processed >= fresh.length + retries.length &&
      delta.filings.length > 0
    ) {
      const newest = delta.filings[delta.filings.length - 1].updatedMs
      if (newest > maxUpdated) {
        maxUpdated = newest
        await kvSet(CURSOR_KEY, new Date(maxUpdated).toISOString())
      }
    }
    const cursorAfter =
      maxUpdated > 0 ? new Date(maxUpdated).toISOString() : cursorBefore
    await persist("success", undefined, cursorAfter)
    log(
      `run #${runId} done: posted ${counters.posted}, sells ${counters.skipped_sell}, other ${counters.skipped_not_purchase}, 10b5-1 ${counters.skipped_10b5_1}, listing ${counters.skipped_listing}, routine ${counters.skipped_routine}, market cap ${counters.skipped_market_cap}, price ${counters.skipped_price}, order ${counters.skipped_order}, deferred ${counters.deferred}, errors ${counters.errors}`
    )
    return { runId, counters }
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    await persist("error", msg.slice(0, 1000)).catch((e) =>
      log(`could not record failure: ${(e as Error).message}`)
    )
    log(`run #${runId} failed: ${msg}`)
    throw err
  } finally {
    setLock(null)
  }
}
