import { mimoJson } from "@/lib/ai/mimo"
import type { Form4, Form4Transaction } from "@/lib/sec/form4"

export type FootnoteCategory =
  | "open_market"
  | "transfer"
  | "gift"
  | "private_transaction"
  | "offering"
  | "plan_purchase"
  | "conversion"
  | "other"

const CATEGORIES: FootnoteCategory[] = [
  "open_market",
  "transfer",
  "gift",
  "private_transaction",
  "offering",
  "plan_purchase",
  "conversion",
  "other",
]

export interface FootnoteFlag {
  category: Exclude<FootnoteCategory, "open_market">
  match: string
  source: string
}

export interface FootnoteReview {
  openMarket: boolean
  category: FootnoteCategory
  reason: string
  flags: FootnoteFlag[]
  model: string
  promptTokens: number | null
  completionTokens: number | null
  reviewedAt: string
}

const RULES: { category: FootnoteFlag["category"]; pattern: RegExp }[] = [
  { category: "gift", pattern: /\bgift(?:s|ed)?\b/gi },
  {
    category: "transfer",
    pattern:
      /\btransfer(?:s|red)?\b|\bdistribut(?:ed|ion)\b|\bin[- ]kind\b|\bcontribut(?:ed|ion)\b|\binherit\w*|\bbequest\b|\bdomestic relations order\b/gi,
  },
  {
    category: "private_transaction",
    pattern:
      /\bprivate(?:ly)?[- ](?:negotiated|placement|transaction|sale|purchase)s?\b|\bsubscription agreement\b|\bsecurities purchase agreement\b|\bdirectly from the (?:issuer|company)\b|\bPIPE\b/gi,
  },
  {
    category: "offering",
    pattern:
      /\b(?:initial )?public offering\b|\bIPO\b|\bunderwrit\w*|\bregistered direct\b|\brights offering\b|\bdirected share program\b/gi,
  },
  {
    category: "plan_purchase",
    pattern:
      /\bemployee stock purchase plan\b|\bESPP\b|\bdividend reinvestment\b|\bDRIP\b|\b401\(k\)|\bdeferred compensation\b/gi,
  },
  {
    category: "conversion",
    pattern:
      /\bconver(?:ted|sion)\b|\bexercised?\b|\bin exchange for\b|\bmerger\b|\bspin[- ]off\b|\breclassif\w*/gi,
  },
]

/** Keyword-rule matches in `text`, one per distinct phrase. */
export function keywordFlags(text: string, source: string): FootnoteFlag[] {
  const out: FootnoteFlag[] = []
  for (const { category, pattern } of RULES)
    for (const m of new Set(
      [...text.matchAll(pattern)].map((x) => x[0].toLowerCase())
    ))
      out.push({ category, match: m, source })
  return out
}

export function isPrivateTransaction(form: Form4, t: Form4Transaction) {
  return t.footnoteIds.some((id) =>
    keywordFlags(form.footnotes[id] ?? "", id).some(
      (f) => f.category === "private_transaction"
    )
  )
}

const SYSTEM = `You review SEC Form 4 filings for a strategy that copies insiders' open-market stock purchases.
Decide whether the code-P purchases in the filing are ordinary open-market purchases: the insider (or an entity they control) bought the issuer's shares on a public exchange, through a broker, at market prices.
They are NOT ordinary when the footnotes, remarks or transaction data show the shares reached the insider another way, for example:
- transfer: shares transferred to the insider from a trust, family member, fund, partnership, estate or other holder; a distribution or in-kind contribution
- gift: shares received as a gift
- private_transaction: a privately negotiated purchase, or a purchase directly from the issuer (private placement, subscription agreement, PIPE)
- offering: shares bought in an IPO, public or registered direct offering, rights offering or directed share program
- plan_purchase: an employee stock purchase plan, dividend reinvestment, 401(k) or deferred compensation purchase
- conversion: shares from converting or exercising another security, or received in an exchange, merger or spin-off
Footnotes that only give a weighted-average price or price range, say the purchase was made in several trades, or explain indirect ownership (held by a trust, LLC, IRA, spouse or fund the insider controls) do not make a purchase abnormal.
The keyword flags come from a simple regex and are often false positives; judge from the text itself. If there are no footnotes or remarks and the transaction data looks normal, the purchases are ordinary.
If any of the purchases is not ordinary, answer openMarket=false with that purchase's category. Keep the reason to one or two sentences that cite the evidence.`

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["openMarket", "category", "reason"],
  properties: {
    openMarket: { type: "boolean" },
    category: { type: "string", enum: CATEGORIES },
    reason: { type: "string" },
  },
}

export async function reviewFootnotes(
  form: Form4,
  buys: Form4Transaction[]
): Promise<FootnoteReview> {
  const ids = [...new Set(buys.flatMap((t) => t.footnoteIds))]
  const flags = [
    ...ids.flatMap((id) => keywordFlags(form.footnotes[id] ?? "", id)),
    ...(form.remarks ? keywordFlags(form.remarks, "remarks") : []),
  ]
  const user = JSON.stringify(
    {
      issuer: form.issuer.name,
      ticker: form.issuer.ticker,
      purchases: buys.map((t) => ({
        date: t.date,
        security: t.securityTitle,
        code: t.code,
        shares: t.shares,
        pricePerShare: t.pricePerShare,
        sharesOwnedAfter: t.sharesAfter,
        ownership: t.ownership === "I" ? "indirect" : "direct",
        natureOfOwnership: t.natureOfOwnership,
        footnotes: t.footnoteIds,
      })),
      footnotes: Object.fromEntries(ids.map((id) => [id, form.footnotes[id]])),
      remarks: form.remarks,
      keywordFlags: flags,
    },
    null,
    2
  )
  const res = await mimoJson<{
    openMarket: boolean
    category: FootnoteCategory
    reason: string
  }>({ system: SYSTEM, user, schema: SCHEMA, schemaName: "footnote_review" })
  return {
    openMarket: res.data.openMarket,
    category: res.data.category,
    reason: res.data.reason,
    flags,
    model: res.model,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    reviewedAt: new Date().toISOString(),
  }
}
