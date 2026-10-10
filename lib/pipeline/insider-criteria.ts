import { isPrivateTransaction } from "@/lib/pipeline/footnotes"
import type { Form4 } from "@/lib/sec/form4"
import {
  fetchHistoricalForm4,
  type InsiderFilingRef,
  listInsiderForm4s,
} from "@/lib/sec/insider"

/*
 * Step 5 insider criteria ("Decoding Inside Information", per the "SEC Filtering Pipeline" Linear doc):
 * - eligible: at least one open-market trade (Form 4 code P or S, non-derivative) in each of the three preceding
 *   calendar years; option exercises, other codes and trades the footnotes call private don't count,
 * - routine: an eligible insider who traded in the filing's trade month in each of those years (for an October 2026
 *   trade: October 2025, 2024 and 2023),
 * - opportunistic: eligible and not routine.
 * Trades in every issuer count, since the rule profiles the insider rather than the stock. The label is stored on the
 * insider for good (lib/pipeline/insiders.ts).
 */

export const CLASSIFIER = "rule:3y-active+trade-month"

export type InsiderVerdict = "routine" | "opportunistic" | "ineligible"

/** One open-market trade from the insider's history, shown as evidence on the dashboard. */
export interface HistoryTrade {
  accession: string
  date: string
  issuer: string
  ticker: string | null
  code: "P" | "S"
  shares: number | null
  price: number | null
  aff10b5One: boolean
}

export interface InsiderEvaluation {
  verdict: InsiderVerdict
  summary: string
  /** The open-market trades the lookup found in the periods it checked. */
  trades: HistoryTrade[]
  /** The rule that produced the label; labels from an older rule (absent here) are recomputed. */
  classifier?: string
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/** Non-derivative, non-private P/S transactions in the form dated with `prefix` ("YYYY-" or "YYYY-MM"). */
function openMarketTradesIn(form: Form4, prefix: string): HistoryTrade[] {
  return form.transactions
    .filter(
      (t) =>
        !t.derivative &&
        (t.code === "P" || t.code === "S") &&
        !isPrivateTransaction(form, t)
    )
    .map((t) => ({
      accession: form.accession,
      date: t.date ?? form.periodOfReport ?? "",
      issuer: form.issuer.name,
      ticker: form.issuer.ticker,
      code: t.code as "P" | "S",
      shares: t.shares,
      price: t.pricePerShare,
      aff10b5One: form.aff10b5One,
    }))
    .filter((t) => t.date.startsWith(prefix))
}

/**
 * Scans one year's filings for open-market trades, one download at a time: filings that can cover the trade month
 * first, stopping at the first trade in that month, then the rest of the year until any trade turns up.
 */
async function scanYear(
  ownerCik: string,
  refs: InsiderFilingRef[],
  year: number,
  mm: string
): Promise<{ inMonth: HistoryTrade[]; inYear: HistoryTrade[] }> {
  const ym = `${year}-${mm}`
  const coversMonth = (r: InsiderFilingRef) =>
    (r.reportDate ?? r.filingDate) <= `${ym}-31` && r.filingDate >= `${ym}-01`
  const monthRefs = refs.filter(coversMonth)
  let inYear: HistoryTrade[] = []
  for (const ref of monthRefs) {
    const form = await fetchHistoricalForm4(ownerCik, ref)
    const found = form ? openMarketTradesIn(form, `${year}-`) : []
    const inMonth = found.filter((t) => t.date.startsWith(ym))
    if (inMonth.length) return { inMonth, inYear: inMonth }
    if (!inYear.length) inYear = found
  }
  for (const ref of refs.filter((r) => !coversMonth(r))) {
    if (inYear.length) break
    const form = await fetchHistoricalForm4(ownerCik, ref)
    inYear = form ? openMarketTradesIn(form, `${year}-`) : []
  }
  return { inMonth: [], inYear }
}

/**
 * Looks up whether the insider traded in each of the three preceding years (eligibility) and in the trade's month in
 * each of them (routine). Only Form 4s that can cover those years are downloaded, years with the fewest candidate
 * filings first, and the lookup stops at the first year without any trade.
 */
export async function lookupInsider(
  ownerCik: string,
  tradeDate: string
): Promise<InsiderEvaluation> {
  const m = /^(\d{4})-(\d{2})/.exec(tradeDate)
  if (!m) throw new Error(`Unparseable trade date "${tradeDate}"`)
  const [year, mm] = [Number(m[1]), m[2]]
  const years = [year - 3, year - 2, year - 1]
  const refs = await listInsiderForm4s(
    ownerCik,
    years.map((y) => ({ key: String(y), from: `${y}-01-01`, to: `${y}-12-31` }))
  )
  // A year with no filings at all settles the verdict without any download.
  const order = [...years].sort((a, b) => refs[a].length - refs[b].length)

  const trades: HistoryTrade[] = []
  const offMonth: number[] = []
  let missing: number | undefined
  for (const y of order) {
    const { inMonth, inYear } = await scanYear(ownerCik, refs[y], y, mm)
    if (!inYear.length) {
      missing = y
      break
    }
    if (!inMonth.length) offMonth.push(y)
    trades.push(...inYear)
  }
  const month = MONTHS[Number(mm) - 1]
  const span = `${years[0]}–${years[2]}`
  const verdict: InsiderVerdict =
    missing !== undefined
      ? "ineligible"
      : offMonth.length
        ? "opportunistic"
        : "routine"
  return {
    verdict,
    summary:
      verdict === "ineligible"
        ? `No open-market trade in ${missing}; needs at least one in each of ${span}.`
        : verdict === "routine"
          ? `Traded in ${month} of each of ${span}.`
          : `Traded in each of ${span}, but not in ${month} ${offMonth.sort().join(", ")}.`,
    trades: trades.sort((a, b) => a.date.localeCompare(b.date)),
    classifier: CLASSIFIER,
  }
}
