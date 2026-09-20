import { grokJson } from "@/lib/ai/grok"
import { env } from "@/lib/env"
import {
  type Form4,
  type Form4Transaction,
  openMarketPurchases,
} from "@/lib/sec/form4"

export type Classification = "routine" | "opportunistic"

export interface HistoryRow {
  accession: string
  reportDate: string | null
  issuer: string
  ticker: string | null
  transactions: {
    date: string | null
    code: string | null
    acquiredDisposed: "A" | "D" | null
    derivative: boolean
    security: string
    shares: number | null
    price: number | null
    value: number | null
    sharesAfter: number | null
    footnotes: string[]
  }[]
  aff10b5One: boolean
  mentions10b5InFootnotes: boolean
}

export interface TradeSummary {
  date: string | null
  shares: number
  avgPrice: number | null
  value: number | null
  sharesAfter: number | null
  transactions: Form4Transaction[]
}

export interface Verdict {
  classification: Classification
  confidence: number
  patternSummary: string
  reasoning: string
  model: string
  promptTokens: number | null
  completionTokens: number | null
  history: HistoryRow[]
  stats: HistoryStats
}

export interface HistoryStats {
  priorFilings: number
  priorOpenMarketBuys: number
  priorSells: number
  priorPlannedFilings: number
  medianDaysBetweenBuys: number | null
  buySizeCv: number | null
  firstBuyDate: string | null
  lastBuyDate: string | null
}

const CODE_LEGEND: Record<string, string> = {
  P: "open-market purchase",
  S: "open-market sale",
  A: "grant/award",
  M: "option exercise/conversion",
  F: "tax withholding",
  G: "gift",
  D: "disposition to issuer",
  C: "conversion",
  X: "exercise of in-the-money derivative",
  J: "other",
  I: "discretionary transaction",
  W: "acquisition/disposition by will",
}

export function summarizeTrade(form: Form4): TradeSummary {
  const buys = openMarketPurchases(form)
  const shares = buys.reduce((s, t) => s + (t.shares ?? 0), 0)
  const priced = buys.filter((t) => t.pricePerShare !== null)
  const value = priced.reduce(
    (s, t) => s + (t.shares ?? 0) * (t.pricePerShare ?? 0),
    0
  )
  const pricedShares = priced.reduce((s, t) => s + (t.shares ?? 0), 0)
  const last = [...buys]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .at(-1)
  return {
    date: last?.date ?? form.periodOfReport,
    shares,
    avgPrice: pricedShares > 0 ? value / pricedShares : null,
    value: pricedShares > 0 ? value : null,
    sharesAfter: last?.sharesAfter ?? null,
    transactions: buys,
  }
}

export function toHistoryRows(history: Form4[]): HistoryRow[] {
  return history.map((f) => ({
    accession: f.accession,
    reportDate: f.periodOfReport,
    issuer: f.issuer.name,
    ticker: f.issuer.ticker,
    aff10b5One: f.aff10b5One,
    mentions10b5InFootnotes: f.mentions10b5InFootnotes,
    transactions: f.transactions.map((t) => ({
      date: t.date,
      code: t.code,
      acquiredDisposed: t.acquiredDisposed,
      derivative: t.derivative,
      security: t.securityTitle,
      shares: t.shares,
      price: t.pricePerShare,
      value:
        t.shares !== null && t.pricePerShare !== null
          ? t.shares * t.pricePerShare
          : null,
      sharesAfter: t.sharesAfter,
      footnotes: t.footnoteIds.map((id) => f.footnotes[id]).filter(Boolean),
    })),
  }))
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function computeStats(
  history: Form4[],
  issuerCik: string
): HistoryStats {
  const sameIssuer = history.filter((f) => f.issuer.cik === issuerCik)
  const buys = sameIssuer.flatMap((f) =>
    openMarketPurchases(f).map((t) => ({
      ...t,
      date: t.date ?? f.periodOfReport,
    }))
  )
  const buyDates = [
    ...new Set(buys.map((b) => b.date).filter((d): d is string => !!d)),
  ].sort()
  const gaps: number[] = []
  for (let i = 1; i < buyDates.length; i++)
    gaps.push(
      (Date.parse(buyDates[i]) - Date.parse(buyDates[i - 1])) / 86_400_000
    )
  const sizes = buys
    .map((b) => (b.shares ?? 0) * (b.pricePerShare ?? 0))
    .filter((v) => v > 0)
  const mean = sizes.length
    ? sizes.reduce((a, b) => a + b, 0) / sizes.length
    : 0
  const sd =
    sizes.length > 1
      ? Math.sqrt(
          sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / (sizes.length - 1)
        )
      : 0
  return {
    priorFilings: history.length,
    priorOpenMarketBuys: buys.length,
    priorSells: sameIssuer
      .flatMap((f) => f.transactions)
      .filter((t) => t.code === "S").length,
    priorPlannedFilings: history.filter(
      (f) => f.aff10b5One || f.mentions10b5InFootnotes
    ).length,
    medianDaysBetweenBuys: median(gaps),
    buySizeCv: sizes.length > 1 && mean > 0 ? sd / mean : null,
    firstBuyDate: buyDates[0] ?? null,
    lastBuyDate: buyDates.at(-1) ?? null,
  }
}

const SYSTEM_PROMPT = `You are an equity analyst who screens SEC Form 4 insider filings. Your job is to decide whether an insider's latest open-market purchase looks ROUTINE or OPPORTUNISTIC, based on that insider's own filing history.

ROUTINE means the purchase fits a regular, recurring, or mechanical pattern, for example:
- purchases on a fixed cadence (monthly, quarterly, every pay period, each earnings window) of similar size,
- dividend reinvestment, employee stock purchase plans, 401(k) or deferred-compensation purchases, director-fee stock purchases,
- purchases that footnotes describe as automatic, pre-arranged, or under a trading plan,
- a steady accumulation program with many similar buys.

OPPORTUNISTIC means the purchase is a sudden, discretionary decision that breaks from the insider's prior behaviour, for example:
- a first open-market purchase, or the first in a long time, especially by an insider who previously only received grants or sold,
- a purchase far larger than the insider's typical buys,
- an irregular, clustered buy with no cadence,
- buying after a stretch of selling.

Judge cadence, size consistency, footnotes, and how much history exists. Sparse or absent buying history makes a purchase OPPORTUNISTIC, not routine. Give a calibrated confidence between 0 and 1. Keep the pattern summary to one sentence and the reasoning to at most four sentences.`

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    classification: { type: "string", enum: ["routine", "opportunistic"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    pattern_summary: { type: "string" },
    reasoning: { type: "string" },
  },
  required: ["classification", "confidence", "pattern_summary", "reasoning"],
}

interface RawVerdict {
  classification: string
  confidence: number
  pattern_summary: string
  reasoning: string
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "n/a"
  return n.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function buildUserPrompt(
  form: Form4,
  trade: TradeSummary,
  rows: HistoryRow[],
  stats: HistoryStats
): string {
  const owner = form.owners[0]
  const lines: string[] = []
  lines.push(`# Latest filing (accession ${form.accession})`)
  lines.push(
    `Issuer: ${form.issuer.name} (${form.issuer.ticker ?? "no ticker"})`
  )
  lines.push(
    `Insider: ${owner?.name ?? "unknown"} — ${[owner?.isOfficer && (owner.officerTitle || "Officer"), owner?.isDirector && "Director", owner?.isTenPercentOwner && "10% owner", owner?.isOther && (owner.otherText || "Other")].filter(Boolean).join(", ") || "role unknown"}`
  )
  lines.push(
    `Trade date: ${trade.date ?? "n/a"}; filed/signed: ${form.signatureDate ?? "n/a"}`
  )
  lines.push(
    `Open-market purchase: ${fmt(trade.shares)} shares at avg $${fmt(trade.avgPrice, 2)} ≈ $${fmt(trade.value)}; shares held after: ${fmt(trade.sharesAfter)}`
  )
  for (const t of trade.transactions) {
    const notes = t.footnoteIds.map((id) => form.footnotes[id]).filter(Boolean)
    lines.push(
      `  - ${t.date ?? "n/a"} ${t.securityTitle}: ${fmt(t.shares)} @ $${fmt(t.pricePerShare, 2)}${t.ownership === "I" ? ` (indirect: ${t.natureOfOwnership ?? ""})` : ""}${notes.length ? ` | footnotes: ${notes.join(" ")}` : ""}`
    )
  }
  const otherTx = form.transactions.filter(
    (t) => !trade.transactions.includes(t)
  )
  if (otherTx.length) {
    lines.push(`Other transactions on this filing:`)
    for (const t of otherTx)
      lines.push(
        `  - ${t.date ?? "n/a"} code ${t.code ?? "?"} (${CODE_LEGEND[t.code ?? ""] ?? "unknown"}) ${t.acquiredDisposed ?? ""} ${fmt(t.shares)} ${t.securityTitle} @ $${fmt(t.pricePerShare, 2)}`
      )
  }
  if (form.remarks) lines.push(`Remarks: ${form.remarks}`)
  lines.push("")
  lines.push(
    `# Insider's prior Form 4 filings (last ${env.historyMonths} months, up to ${env.historyMaxFilings}, oldest first)`
  )
  lines.push(
    `Stats: ${stats.priorFilings} prior filings; ${stats.priorOpenMarketBuys} prior open-market buys in this issuer; ${stats.priorSells} prior sales; ${stats.priorPlannedFilings} filings flagged 10b5-1; median days between buys: ${stats.medianDaysBetweenBuys === null ? "n/a" : stats.medianDaysBetweenBuys.toFixed(0)}; buy-size coefficient of variation: ${stats.buySizeCv === null ? "n/a" : stats.buySizeCv.toFixed(2)}; first buy ${stats.firstBuyDate ?? "n/a"}, last buy ${stats.lastBuyDate ?? "n/a"}.`
  )
  if (rows.length === 0) lines.push("(no prior Form 4 filings found)")
  for (const r of rows) {
    lines.push(
      `- ${r.reportDate ?? "n/a"} ${r.ticker ?? r.issuer}${r.aff10b5One ? " [10b5-1 box checked]" : ""}${!r.aff10b5One && r.mentions10b5InFootnotes ? " [10b5-1 in footnotes]" : ""}`
    )
    for (const t of r.transactions) {
      lines.push(
        `    ${t.date ?? "n/a"} code ${t.code ?? "?"} (${CODE_LEGEND[t.code ?? ""] ?? "unknown"}) ${t.acquiredDisposed ?? ""} ${fmt(t.shares)} ${t.derivative ? "[derivative] " : ""}${t.security} @ $${fmt(t.price, 2)}${t.value ? ` ≈ $${fmt(t.value)}` : ""}${t.sharesAfter !== null ? `; after: ${fmt(t.sharesAfter)}` : ""}${t.footnotes.length ? ` | ${t.footnotes.join(" ").slice(0, 300)}` : ""}`
      )
    }
  }
  lines.push("")
  lines.push(
    "Transaction code legend: " +
      Object.entries(CODE_LEGEND)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
  )
  lines.push("")
  lines.push(
    "Classify the latest open-market purchase as routine or opportunistic."
  )
  return lines.join("\n")
}

/** Uses Grok to decide whether the insider's purchase fits a routine pattern. */
export async function classifyTrade(
  form: Form4,
  trade: TradeSummary,
  history: Form4[]
): Promise<Verdict> {
  const rows = toHistoryRows(history)
  const stats = computeStats(history, form.issuer.cik)
  if (history.length === 0) {
    return {
      classification: "opportunistic",
      confidence: 0.9,
      patternSummary: "No prior Form 4 filings on record for this insider.",
      reasoning: `No Form 4 filings were found for this insider in the last ${env.historyMonths} months, so there is no routine pattern this purchase could belong to. Treated as a sudden, discretionary buy without calling the model.`,
      model: "heuristic:no-history",
      promptTokens: null,
      completionTokens: null,
      history: rows,
      stats,
    }
  }
  const result = await grokJson<RawVerdict>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(form, trade, rows, stats),
    schema: VERDICT_SCHEMA,
    schemaName: "insider_trade_verdict",
  })
  const raw = result.data
  const classification: Classification =
    raw.classification === "routine" ? "routine" : "opportunistic"
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0))
  return {
    classification,
    confidence,
    patternSummary: String(raw.pattern_summary ?? "").trim(),
    reasoning: String(raw.reasoning ?? "").trim(),
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    history: rows,
    stats,
  }
}
