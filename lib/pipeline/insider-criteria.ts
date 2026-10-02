import type { Form4 } from "@/lib/sec/form4"
import {
  fetchHistoricalForm4,
  type InsiderFilingRef,
  listInsiderForm4s,
} from "@/lib/sec/insider"

/*
 * Step 4 insider criteria: an insider who made an open-market trade (Form 4 code P or S, non-derivative) in the
 * filing's trade month in each of the three preceding years is routine; anyone else is opportunistic. For a trade in
 * October 2026 that means October 2025, October 2024 and October 2023. Trades in every issuer count, since the rule
 * profiles the insider rather than the stock. The label is stored on the insider for good (lib/pipeline/insiders.ts).
 */

export const CLASSIFIER = "rule:trade-month-3y"

export type InsiderVerdict = "routine" | "opportunistic"

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
  /** The open-market trades the lookup found in the months it checked. */
  trades: HistoryTrade[]
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/** Non-derivative P/S transactions in the form dated within `ym` ("YYYY-MM"). */
function openMarketTradesIn(form: Form4, ym: string): HistoryTrade[] {
  return form.transactions
    .filter((t) => !t.derivative && (t.code === "P" || t.code === "S"))
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
    .filter((t) => t.date.startsWith(ym))
}

/** The open-market trades in `ym` from the first of `refs` that has any, downloading one filing at a time. */
async function firstTradesIn(
  ownerCik: string,
  refs: InsiderFilingRef[],
  ym: string
): Promise<HistoryTrade[]> {
  for (const ref of refs) {
    const form = await fetchHistoricalForm4(ownerCik, ref)
    const found = form ? openMarketTradesIn(form, ym) : []
    if (found.length) return found
  }
  return []
}

/**
 * Looks up whether the insider made an open-market trade in the trade's month in each of the three preceding years.
 * Only Form 4s that can cover those three months are downloaded, and the lookup stops at the first year without a
 * trade, so most opportunistic insiders cost a single SEC request.
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
    years.map((y) => `${y}-${mm}`)
  )
  // Years with the fewest candidate filings first: a year with none settles the verdict without any download.
  const order = [...years].sort(
    (a, b) => refs[`${a}-${mm}`].length - refs[`${b}-${mm}`].length
  )

  const trades: HistoryTrade[] = []
  let missing: number | undefined
  for (const y of order) {
    const ym = `${y}-${mm}`
    const found = await firstTradesIn(ownerCik, refs[ym], ym)
    if (!found.length) {
      missing = y
      break
    }
    trades.push(...found)
  }
  const month = MONTHS[Number(mm) - 1]
  const span = `${month} of each of ${years[0]}–${years[2]}`
  return {
    verdict: missing === undefined ? "routine" : "opportunistic",
    summary:
      missing === undefined
        ? `Traded in ${span}.`
        : `No open-market trade in ${month} ${missing}; routine needs one in ${span}.`,
    trades: trades.sort((a, b) => a.date.localeCompare(b.date)),
  }
}
