import { and, eq, inArray, lt, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

import { classifyTrade, summarizeTrade, type Verdict } from "@/lib/ai/classify"
import {
  AlpacaError,
  alpacaConfigured,
  getOrderByClientId,
  placeMarketBuy,
  type AlpacaOrder,
} from "@/lib/alpaca/client"
import {
  filings,
  getDb,
  insiderAnalyses,
  insiders,
  kvGet,
  kvSet,
  now,
  pollRuns,
  stocks,
  trades,
  type FilingStatus,
} from "@/lib/db"
import { env } from "@/lib/env"
import { cikPadded, filingIndexHtmlUrl } from "@/lib/sec/client"
import { fetchFeedDelta, type FeedFiling } from "@/lib/sec/feed"
import {
  describeRole,
  fetchForm4,
  type Form4,
  openMarketPurchases,
} from "@/lib/sec/form4"
import { cacheForm4, getInsiderHistory } from "@/lib/sec/insider"
import { getIssuerProfile } from "@/lib/sec/issuer"

export type { FilingStatus }

export const CURSOR_KEY = "feed_cursor_updated"
export const LAST_RUN_KEY = "last_run_started_at"

export type PollTrigger = "schedule" | "manual" | "cli"

export interface RunCounters {
  feed_entries: number
  new_filings: number
  skipped_10b5_1: number
  skipped_sell: number
  skipped_not_purchase: number
  skipped_routine: number
  posted: number
  errors: number
}

export interface PollOptions {
  /** Process at most this many new filings (useful for smoke tests). */
  limit?: number
  /** Override the lookback used when no cursor exists yet. */
  lookbackHours?: number
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

/** `COALESCE(new, existing)` — only overwrite a column when we learned something. */
const keep = (col: AnyPgColumn, v: unknown) =>
  sql`COALESCE(${v ?? null}, ${col})`

async function finishFiling(
  accession: string,
  status: FilingStatus,
  reason: string | null,
  form: Form4 | null,
  runId: number
) {
  const owner = form?.owners[0]
  await getDb()
    .update(filings)
    .set({
      status,
      reason,
      processedAt: new Date(),
      runId,
      attempts: sql`${filings.attempts} + 1`,
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

async function recordAnalysis(form: Form4, verdict: Verdict) {
  await getDb()
    .insert(insiderAnalyses)
    .values({
      accession: form.accession,
      insiderCik: form.owners[0]?.cik ?? "",
      issuerCik: form.issuer.cik,
      model: verdict.model,
      classification: verdict.classification,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      patternSummary: verdict.patternSummary,
      history: { stats: verdict.stats, filings: verdict.history },
      promptTokens: verdict.promptTokens,
      completionTokens: verdict.completionTokens,
    })
}

function relationshipOf(form: Form4): {
  title: string | null
  relationship: string | null
} {
  const o = form.owners[0]
  if (!o) return { title: null, relationship: null }
  const rel: string[] = []
  if (o.isOfficer) rel.push("Officer")
  if (o.isDirector) rel.push("Director")
  if (o.isTenPercentOwner) rel.push("10% Owner")
  if (o.isOther) rel.push("Other")
  return {
    title: o.officerTitle ?? o.otherText ?? (o.isDirector ? "Director" : null),
    relationship: rel.join(", ") || null,
  }
}

/** Writes the signal as stock + insider + trade rows (the Eraser ERD) in one transaction. */
async function postTrade(
  form: Form4,
  verdict: Verdict,
  filedDate: string | null
) {
  const owner = form.owners[0]
  if (!owner?.cik) throw new Error("Form 4 has no reporting owner CIK")
  const trade = summarizeTrade(form)
  const stockId = cikPadded(form.issuer.cik)
  const insiderId = cikPadded(owner.cik)
  let exchange: string | null = null
  let sector: string | null = null
  try {
    const profile = await getIssuerProfile(stockId)
    exchange = profile.exchanges.join(", ") || null
    sector = profile.sicDescription
  } catch (err) {
    console.warn(
      `[synra] issuer profile unavailable for ${stockId}: ${(err as Error).message}`
    )
  }
  const { title, relationship } = relationshipOf(form)
  const tradeRow = {
    insiderId,
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
    aiClassification: verdict.classification,
    aiConfidence: verdict.confidence,
    aiReasoning: verdict.reasoning,
    aiPattern: verdict.patternSummary,
    aiModel: verdict.model,
    history: { stats: verdict.stats, filings: verdict.history },
    filingUrl: form.indexUrl,
  }

  await getDb().transaction(async (tx) => {
    await tx
      .insert(stocks)
      .values({
        id: stockId,
        ticker: form.issuer.ticker,
        companyName: form.issuer.name ?? stockId,
        exchange,
        sector,
      })
      .onConflictDoUpdate({
        target: stocks.id,
        set: {
          ticker: keep(stocks.ticker, form.issuer.ticker),
          companyName: form.issuer.name ?? stockId,
          exchange: keep(stocks.exchange, exchange),
          sector: keep(stocks.sector, sector),
          updatedAt: now,
        },
      })
    await tx
      .insert(insiders)
      .values({
        id: insiderId,
        name: owner.name ?? insiderId,
        title,
        relationship,
        company: form.issuer.name,
      })
      .onConflictDoUpdate({
        target: insiders.id,
        set: {
          name: owner.name ?? insiderId,
          title: keep(insiders.title, title),
          relationship: keep(insiders.relationship, relationship),
          company: keep(insiders.company, form.issuer.name),
          updatedAt: now,
        },
      })
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
 * Mirrors a posted trade as a paper order on Alpaca: a $ALPACA_ORDER_NOTIONAL market buy of the issuer's ticker.
 * The accession number doubles as Alpaca's client_order_id, so re-posting a filing can never buy twice.
 * Failures are recorded on the trade row and logged; they never undo the post itself.
 */
async function placeAlpacaOrder(
  form: Form4,
  referencePrice: number | null,
  log: (m: string) => void
): Promise<void> {
  const db = getDb()
  const accession = form.accession
  const fail = (msg: string) =>
    db
      .update(trades)
      .set({ alpacaOrderError: msg.slice(0, 500), updatedAt: now })
      .where(eq(trades.id, accession))
  if (!alpacaConfigured()) {
    log(`  alpaca: skipped (ALPACA_KEY / ALPACA_SECRET not set)`)
    await fail("Alpaca credentials not configured")
    return
  }
  const [existing] = await db
    .select({ orderId: trades.alpacaOrderId })
    .from(trades)
    .where(eq(trades.id, accession))
  if (existing?.orderId) {
    log(`  alpaca: order ${existing.orderId} already placed for ${accession}`)
    return
  }
  const symbol = form.issuer.ticker?.trim().toUpperCase()
  if (!symbol) {
    log(`  alpaca: skipped, filing has no ticker`)
    await fail("Form 4 has no issuer ticker")
    return
  }
  const notional = env.alpacaOrderNotional
  let order: AlpacaOrder
  try {
    order = await placeMarketBuy({
      symbol,
      notional,
      clientOrderId: accession,
      referencePrice,
    })
  } catch (err) {
    // 42210000 "client_order_id must be unique": an earlier attempt got through but we lost the response.
    if (
      err instanceof AlpacaError &&
      (err.code === 42210000 ||
        /client_order_id must be unique/i.test(err.message))
    ) {
      order = await getOrderByClientId(accession)
    } else {
      const msg = (err as Error).message ?? String(err)
      log(`  alpaca: order failed for ${symbol}: ${msg}`)
      await fail(msg)
      return
    }
  }
  await db
    .update(trades)
    .set({
      alpacaOrderId: order.id,
      alpacaClientOrderId: order.client_order_id,
      alpacaOrderStatus: order.status,
      alpacaOrderNotional: order.notional ? Number(order.notional) : null,
      alpacaOrderQty: order.qty ? Number(order.qty) : null,
      alpacaOrderError: null,
      alpacaOrderedAt: new Date(order.submitted_at ?? order.created_at),
      updatedAt: now,
    })
    .where(eq(trades.id, accession))
  const size = order.notional ? `$${order.notional}` : `${order.qty} sh`
  log(
    `  alpaca: ${order.side} ${size} ${symbol} → ${order.status} (${order.id})`
  )
}

/** Runs the full evaluation for one filing and returns the resulting status. */
async function evaluateFiling(
  f: FeedFiling,
  runId: number,
  log: (m: string) => void
): Promise<FilingStatus> {
  const form = await fetchForm4(f.pathCik, f.accession)
  await cacheForm4(form)
  const label = `${form.issuer.ticker ?? form.issuer.name} / ${form.owners[0]?.name ?? "?"} (${f.accession})`

  if (form.documentType !== "4") {
    await finishFiling(
      f.accession,
      "skipped_not_purchase",
      `Document type ${form.documentType}`,
      form,
      runId
    )
    return "skipped_not_purchase"
  }
  // Step 1: planned trades and sells are out.
  if (form.aff10b5One) {
    await finishFiling(
      f.accession,
      "skipped_10b5_1",
      "Rule 10b5-1 checkbox is checked",
      form,
      runId
    )
    log(`  10b5-1 (checkbox) → skip ${label}`)
    return "skipped_10b5_1"
  }
  if (form.mentions10b5InFootnotes) {
    await finishFiling(
      f.accession,
      "skipped_10b5_1",
      "Footnotes state the trade was made under a Rule 10b5-1 plan",
      form,
      runId
    )
    log(`  10b5-1 (footnote) → skip ${label}`)
    return "skipped_10b5_1"
  }
  const buys = openMarketPurchases(form)
  if (buys.length === 0) {
    const codes = [...new Set(form.transactions.map((t) => t.code ?? "?"))]
    const anyAcquired = form.transactions.some(
      (t) => t.acquiredDisposed === "A"
    )
    if (form.transactions.length === 0) {
      await finishFiling(
        f.accession,
        "skipped_not_purchase",
        "No transactions reported (holdings only)",
        form,
        runId
      )
      return "skipped_not_purchase"
    }
    if (!anyAcquired || form.transactions.some((t) => t.code === "S")) {
      await finishFiling(
        f.accession,
        "skipped_sell",
        `Sale/disposition only (codes ${codes.join(", ")})`,
        form,
        runId
      )
      log(`  sell → skip ${label}`)
      return "skipped_sell"
    }
    await finishFiling(
      f.accession,
      "skipped_not_purchase",
      `No open-market purchase (codes ${codes.join(", ")})`,
      form,
      runId
    )
    return "skipped_not_purchase"
  }

  // Step 2: look at the insider's own history and ask Grok whether the buy is routine.
  const ownerCik = form.owners[0]?.cik
  if (!ownerCik) throw new Error("Form 4 has no reporting owner CIK")
  const history = await getInsiderHistory(ownerCik, f.accession)
  const trade = summarizeTrade(form)
  const verdict = await classifyTrade(form, trade, history)
  await recordAnalysis(form, verdict)
  if (verdict.classification === "routine") {
    await finishFiling(
      f.accession,
      "skipped_routine",
      `Grok: routine (${Math.round(verdict.confidence * 100)}%) — ${verdict.patternSummary}`,
      form,
      runId
    )
    log(`  routine (${Math.round(verdict.confidence * 100)}%) → skip ${label}`)
    return "skipped_routine"
  }

  // Step 3: post it, then mirror it as a paper trade.
  await postTrade(form, verdict, f.filedDate)
  await placeAlpacaOrder(form, trade.avgPrice, log)
  finishFiling(
    f.accession,
    "posted",
    `Grok: opportunistic (${Math.round(verdict.confidence * 100)}%) — ${verdict.patternSummary}`,
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
  const cursorBefore = await kvGet(CURSOR_KEY)
  const [{ id: runId }] = await db
    .insert(pollRuns)
    .values({ trigger, status: "running", startedAt: started, cursorBefore })
    .returning({ id: pollRuns.id })
  setLock({ runId, startedAt })
  await kvSet(LAST_RUN_KEY, startedAt)
  const counters: RunCounters = {
    feed_entries: 0,
    new_filings: 0,
    skipped_10b5_1: 0,
    skipped_sell: 0,
    skipped_not_purchase: 0,
    skipped_routine: 0,
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
        skippedRoutine: counters.skipped_routine,
        posted: counters.posted,
        errors: counters.errors,
      })
      .where(eq(pollRuns.id, runId))

  try {
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

    let maxUpdated = cursorBefore ? Date.parse(cursorBefore) : 0
    let processed = 0
    for (const f of queue) {
      await db
        .update(filings)
        .set({ status: "processing", runId })
        .where(eq(filings.accession, f.accession))
      try {
        const status = await evaluateFiling(f, runId, log)
        if (status !== "posted" && status !== "error")
          counters[status as keyof RunCounters] += 1
        if (status === "posted") counters.posted += 1
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
      queue.length >= fresh.length + retries.length &&
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
      `run #${runId} done: posted ${counters.posted}, routine ${counters.skipped_routine}, 10b5-1 ${counters.skipped_10b5_1}, sells ${counters.skipped_sell}, other ${counters.skipped_not_purchase}, errors ${counters.errors}`
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
