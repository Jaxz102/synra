import type { Form4 } from "@/lib/sec/form4"
import { listInsiderForm4s, loadInsiderForm4s } from "@/lib/sec/insider"

/*
 * Insider criteria from Cohen, Malloy & Pomorski, "Decoding Inside Information" (2012), as specified in the
 * "SEC Filtering Pipeline" Linear doc:
 * - eligible: at least one open-market trade (Form 4 code P or S, non-derivative) in each of the three preceding
 *   calendar years; option exercises and other codes don't count,
 * - routine: traded in the same calendar month in each of those three years,
 * - opportunistic: eligible and not routine.
 * Trades in every issuer count, since the rule profiles the insider rather than the stock.
 */

export const CLASSIFIER = "rule:same-month-3y"

export type InsiderVerdict = "routine" | "opportunistic" | "ineligible"

export interface InsiderCriteria {
  verdict: InsiderVerdict
  /** The three preceding calendar years, oldest first. */
  years: number[]
  /** Months (1-12) with an open-market trade, per year checked. Years that were never loaded are absent. */
  monthsByYear: Record<string, number[]>
  /** Months traded in every one of the three years; non-empty only for routine insiders. */
  routineMonths: number[]
  summary: string
  detail: string
}

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

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")
const monthName = (m: number) => MONTHS[m - 1]
const yearOf = (date: string) => Number(date.slice(0, 4))
const monthOf = (date: string) => Number(date.slice(5, 7))

export function precedingYears(tradeDate: string | null): number[] {
  const y = tradeDate ? yearOf(tradeDate) : new Date().getUTCFullYear()
  return [y - 3, y - 2, y - 1]
}

/** Non-derivative P/S transactions dated within `years`. */
export function openMarketTrades(
  forms: Form4[],
  years: number[]
): HistoryTrade[] {
  return forms
    .flatMap((f) =>
      f.transactions
        .filter((t) => !t.derivative && (t.code === "P" || t.code === "S"))
        .map((t) => ({
          accession: f.accession,
          date: t.date ?? f.periodOfReport ?? "",
          issuer: f.issuer.name,
          ticker: f.issuer.ticker,
          code: t.code as "P" | "S",
          shares: t.shares,
          price: t.pricePerShare,
          aff10b5One: f.aff10b5One,
        }))
    )
    .filter(
      (t) => /^\d{4}-\d{2}/.test(t.date) && years.includes(yearOf(t.date))
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

function formatMonths(monthsByYear: Record<string, number[]>, years: number[]) {
  return years
    .map(
      (y) =>
        `${y}: ${monthsByYear[y] === undefined ? "not checked" : monthsByYear[y].map(monthName).join(", ") || "none"}`
    )
    .join(" · ")
}

export function classifyInsider(
  trades: HistoryTrade[],
  years: number[]
): InsiderCriteria {
  const monthsByYear: Record<string, number[]> = {}
  for (const y of years)
    monthsByYear[y] = [
      ...new Set(
        trades.filter((t) => yearOf(t.date) === y).map((t) => monthOf(t.date))
      ),
    ].sort((a, b) => a - b)
  const detail = formatMonths(monthsByYear, years)
  const missing = years.filter((y) => monthsByYear[y].length === 0)
  if (missing.length)
    return {
      verdict: "ineligible",
      years,
      monthsByYear,
      routineMonths: [],
      summary: `No open-market trades in ${missing.join(", ")}; needs at least one in each of ${years[0]}–${years[2]}.`,
      detail,
    }
  const routineMonths = MONTHS.map((_, i) => i + 1).filter((m) =>
    years.every((y) => monthsByYear[y].includes(m))
  )
  if (routineMonths.length)
    return {
      verdict: "routine",
      years,
      monthsByYear,
      routineMonths,
      summary: `Traded in ${routineMonths.map(monthName).join(", ")} in each of ${years[0]}–${years[2]}.`,
      detail,
    }
  return {
    verdict: "opportunistic",
    years,
    monthsByYear,
    routineMonths,
    summary: `Traded every year ${years[0]}–${years[2]}, but in no calendar month common to all three.`,
    detail,
  }
}

/**
 * Loads the insider's Form 4s for the three calendar years before the trade and applies the criteria. Years with no
 * Form 4 at all are detected from the filing index alone, so ineligible insiders cost one SEC request.
 */
export async function evaluateInsider(
  ownerCik: string,
  tradeDate: string | null
): Promise<{ criteria: InsiderCriteria; trades: HistoryTrade[] }> {
  const years = precedingYears(tradeDate)
  const refs = await listInsiderForm4s(ownerCik, {
    from: `${years[0]}-01-01`,
    to: `${years[2]}-12-31`,
  })
  const unfiled = years.filter(
    (y) =>
      !refs.some(
        (r) =>
          yearOf(r.reportDate ?? r.filingDate) <= y && yearOf(r.filingDate) >= y
      )
  )
  if (unfiled.length) {
    const monthsByYear = Object.fromEntries(unfiled.map((y) => [y, []]))
    return {
      criteria: {
        verdict: "ineligible",
        years,
        monthsByYear,
        routineMonths: [],
        summary: `No Form 4 filings covering ${unfiled.join(", ")}; needs an open-market trade in each of ${years[0]}–${years[2]}.`,
        detail: formatMonths(monthsByYear, years),
      },
      trades: [],
    }
  }
  const trades = openMarketTrades(
    await loadInsiderForm4s(ownerCik, refs),
    years
  )
  return { criteria: classifyInsider(trades, years), trades }
}
