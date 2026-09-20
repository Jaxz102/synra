import { XMLParser } from "fast-xml-parser"
import {
  filingBaseUrl,
  filingIndexHtmlUrl,
  secJson,
  secText,
} from "@/lib/sec/client"

export interface Form4Owner {
  cik: string
  name: string
  isDirector: boolean
  isOfficer: boolean
  isTenPercentOwner: boolean
  isOther: boolean
  officerTitle: string | null
  otherText: string | null
}

export interface Form4Transaction {
  derivative: boolean
  securityTitle: string
  date: string | null
  deemedDate: string | null
  code: string | null
  formType: string | null
  equitySwap: boolean
  acquiredDisposed: "A" | "D" | null
  shares: number | null
  pricePerShare: number | null
  sharesAfter: number | null
  ownership: "D" | "I" | null
  natureOfOwnership: string | null
  exercisePrice: number | null
  underlyingTitle: string | null
  underlyingShares: number | null
  footnoteIds: string[]
}

export interface Form4Holding {
  derivative: boolean
  securityTitle: string
  shares: number | null
  ownership: "D" | "I" | null
  natureOfOwnership: string | null
}

export interface Form4 {
  accession: string
  documentType: string
  schemaVersion: string | null
  periodOfReport: string | null
  aff10b5One: boolean
  mentions10b5InFootnotes: boolean
  issuer: { cik: string; name: string; ticker: string | null }
  owners: Form4Owner[]
  transactions: Form4Transaction[]
  holdings: Form4Holding[]
  footnotes: Record<string, string>
  remarks: string | null
  signatureDate: string | null
  xmlUrl: string
  indexUrl: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) =>
    [
      "nonDerivativeTransaction",
      "derivativeTransaction",
      "nonDerivativeHolding",
      "derivativeHolding",
      "reportingOwner",
      "footnote",
      "footnoteId",
    ].includes(name),
})

type AnyNode = Record<string, unknown> | string | number | undefined | null

function text(node: AnyNode): string | null {
  if (node === undefined || node === null) return null
  if (typeof node === "string") return node.trim() || null
  if (typeof node === "number") return String(node)
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"]
    if (t !== undefined) return String(t).trim() || null
  }
  return null
}

/** Reads the `<value>` child of a Form 4 value element. */
function val(node: AnyNode): string | null {
  if (!node || typeof node !== "object") return text(node)
  return text((node as Record<string, unknown>).value as AnyNode)
}

function num(node: AnyNode): number | null {
  const s = val(node)
  if (s === null) return null
  const n = Number(s.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function bool(node: AnyNode): boolean {
  const s = (val(node) ?? text(node) ?? "").toLowerCase()
  return s === "1" || s === "true"
}

function footnoteIds(...nodes: AnyNode[]): string[] {
  const ids = new Set<string>()
  const walk = (n: AnyNode) => {
    if (!n || typeof n !== "object") return
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === "footnoteId") {
        for (const f of Array.isArray(v) ? v : [v]) {
          const id = (f as Record<string, string>)?.["@_id"]
          if (id) ids.add(id)
        }
      } else if (v && typeof v === "object") {
        walk(v as AnyNode)
      }
    }
  }
  nodes.forEach(walk)
  return [...ids]
}

function parseTransaction(
  t: Record<string, unknown>,
  derivative: boolean
): Form4Transaction {
  const coding = t.transactionCoding as Record<string, unknown> | undefined
  const amounts = t.transactionAmounts as Record<string, unknown> | undefined
  const post = t.postTransactionAmounts as Record<string, unknown> | undefined
  const nature = t.ownershipNature as Record<string, unknown> | undefined
  const underlying = t.underlyingSecurity as Record<string, unknown> | undefined
  const ad = val(amounts?.transactionAcquiredDisposedCode as AnyNode)
  const own = val(nature?.directOrIndirectOwnership as AnyNode)
  return {
    derivative,
    securityTitle: val(t.securityTitle as AnyNode) ?? "",
    date: val(t.transactionDate as AnyNode),
    deemedDate: val(t.deemedExecutionDate as AnyNode),
    code: text(coding?.transactionCode as AnyNode),
    formType: text(coding?.transactionFormType as AnyNode),
    equitySwap: bool(coding?.equitySwapInvolved as AnyNode),
    acquiredDisposed: ad === "A" || ad === "D" ? ad : null,
    shares:
      num(amounts?.transactionShares as AnyNode) ??
      num(amounts?.transactionTotalValue as AnyNode),
    pricePerShare: num(amounts?.transactionPricePerShare as AnyNode),
    sharesAfter: num(post?.sharesOwnedFollowingTransaction as AnyNode),
    ownership: own === "D" || own === "I" ? own : null,
    natureOfOwnership: val(nature?.natureOfOwnership as AnyNode),
    exercisePrice: num(t.conversionOrExercisePrice as AnyNode),
    underlyingTitle: val(underlying?.underlyingSecurityTitle as AnyNode),
    underlyingShares: num(underlying?.underlyingSecurityShares as AnyNode),
    footnoteIds: footnoteIds(t as AnyNode),
  }
}

function parseHolding(
  h: Record<string, unknown>,
  derivative: boolean
): Form4Holding {
  const post = h.postTransactionAmounts as Record<string, unknown> | undefined
  const nature = h.ownershipNature as Record<string, unknown> | undefined
  const own = val(nature?.directOrIndirectOwnership as AnyNode)
  return {
    derivative,
    securityTitle: val(h.securityTitle as AnyNode) ?? "",
    shares: num(post?.sharesOwnedFollowingTransaction as AnyNode),
    ownership: own === "D" || own === "I" ? own : null,
    natureOfOwnership: val(nature?.natureOfOwnership as AnyNode),
  }
}

export function parseForm4Xml(
  xml: string,
  meta: { accession: string; xmlUrl: string; indexUrl: string }
): Form4 {
  const doc = parser.parse(xml)?.ownershipDocument as
    Record<string, unknown> | undefined
  if (!doc) throw new Error(`Not an ownershipDocument: ${meta.xmlUrl}`)
  const issuer = (doc.issuer ?? {}) as Record<string, unknown>
  const owners = ((doc.reportingOwner ?? []) as Record<string, unknown>[]).map(
    (o) => {
      const id = (o.reportingOwnerId ?? {}) as Record<string, unknown>
      const rel = (o.reportingOwnerRelationship ?? {}) as Record<
        string,
        unknown
      >
      return {
        cik: text(id.rptOwnerCik as AnyNode) ?? "",
        name: text(id.rptOwnerName as AnyNode) ?? "",
        isDirector: bool(rel.isDirector as AnyNode),
        isOfficer: bool(rel.isOfficer as AnyNode),
        isTenPercentOwner: bool(rel.isTenPercentOwner as AnyNode),
        isOther: bool(rel.isOther as AnyNode),
        officerTitle: text(rel.officerTitle as AnyNode),
        otherText: text(rel.otherText as AnyNode),
      } satisfies Form4Owner
    }
  )
  const nonDeriv = (doc.nonDerivativeTable ?? {}) as Record<string, unknown>
  const deriv = (doc.derivativeTable ?? {}) as Record<string, unknown>
  const transactions = [
    ...(
      (nonDeriv.nonDerivativeTransaction ?? []) as Record<string, unknown>[]
    ).map((t) => parseTransaction(t, false)),
    ...((deriv.derivativeTransaction ?? []) as Record<string, unknown>[]).map(
      (t) => parseTransaction(t, true)
    ),
  ]
  const holdings = [
    ...((nonDeriv.nonDerivativeHolding ?? []) as Record<string, unknown>[]).map(
      (h) => parseHolding(h, false)
    ),
    ...((deriv.derivativeHolding ?? []) as Record<string, unknown>[]).map((h) =>
      parseHolding(h, true)
    ),
  ]
  const footnotes: Record<string, string> = {}
  for (const f of ((doc.footnotes as Record<string, unknown>)?.footnote ??
    []) as Record<string, unknown>[]) {
    const id = f["@_id"] as string | undefined
    const body = text(f as AnyNode)
    if (id && body) footnotes[id] = body
  }
  const allFootnoteText = Object.values(footnotes).join(" ")
  const sig = doc.ownerSignature
  const sigNode = (Array.isArray(sig) ? sig[0] : sig) as
    Record<string, unknown> | undefined
  return {
    accession: meta.accession,
    documentType: text(doc.documentType as AnyNode) ?? "",
    schemaVersion: text(doc.schemaVersion as AnyNode),
    periodOfReport: text(doc.periodOfReport as AnyNode),
    aff10b5One: bool(doc.aff10b5One as AnyNode),
    mentions10b5InFootnotes: /10b5-?1/i.test(allFootnoteText),
    issuer: {
      cik: text(issuer.issuerCik as AnyNode) ?? "",
      name: text(issuer.issuerName as AnyNode) ?? "",
      ticker: text(issuer.issuerTradingSymbol as AnyNode),
    },
    owners,
    transactions,
    holdings,
    footnotes,
    remarks: text(doc.remarks as AnyNode),
    signatureDate: text(sigNode?.signatureDate as AnyNode),
    xmlUrl: meta.xmlUrl,
    indexUrl: meta.indexUrl,
  }
}

interface DirectoryIndex {
  directory?: { item?: { name: string; type?: string; size?: string }[] }
}

/** Finds the primary Form 4 XML document inside a filing folder. */
export async function locateForm4Xml(
  cik: string,
  accession: string
): Promise<string> {
  const base = filingBaseUrl(cik, accession)
  const idx = await secJson<DirectoryIndex>(`${base}/index.json`)
  const items = idx.directory?.item ?? []
  const xmls = items
    .map((i) => i.name)
    .filter((n) => /\.xml$/i.test(n) && !/^xsl/i.test(n))
  if (xmls.length === 0) throw new Error(`No XML document found in ${base}`)
  const preferred =
    xmls.find((n) => /form4|ownership|primary_doc|f345/i.test(n)) ??
    xmls.find((n) => !/ex[-_]?\d/i.test(n)) ??
    xmls[0]
  return `${base}/${preferred}`
}

export async function fetchForm4(
  cik: string,
  accession: string,
  xmlUrl?: string
): Promise<Form4> {
  const url = xmlUrl ?? (await locateForm4Xml(cik, accession))
  const xml = await secText(url)
  return parseForm4Xml(xml, {
    accession,
    xmlUrl: url,
    indexUrl: filingIndexHtmlUrl(cik, accession),
  })
}

/** Open-market purchases are the only transactions Synra treats as a signal. */
export function openMarketPurchases(form: Form4): Form4Transaction[] {
  return form.transactions.filter(
    (t) =>
      !t.derivative &&
      t.code === "P" &&
      t.acquiredDisposed === "A" &&
      (t.shares ?? 0) > 0
  )
}

export function describeRole(o: Form4Owner | undefined): string {
  if (!o) return "Insider"
  const parts: string[] = []
  if (o.isOfficer) parts.push(o.officerTitle || "Officer")
  if (o.isDirector) parts.push("Director")
  if (o.isTenPercentOwner) parts.push("10% Owner")
  if (o.isOther) parts.push(o.otherText || "Other")
  return parts.join(" · ") || "Insider"
}
