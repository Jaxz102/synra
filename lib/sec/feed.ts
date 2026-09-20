import { XMLParser } from "fast-xml-parser"
import { secText } from "@/lib/sec/client"

export interface FeedEntry {
  accession: string
  formType: string
  cik: string
  entityName: string
  role: "Issuer" | "Reporting" | "Unknown"
  updated: string
  updatedMs: number
  filedDate: string | null
  indexUrl: string
}

/** One filing may appear several times in the feed (once per issuer and per reporting owner). */
export interface FeedFiling {
  accession: string
  formType: string
  updated: string
  updatedMs: number
  filedDate: string | null
  issuerCik: string | null
  issuerName: string | null
  reportingCiks: string[]
  reportingNames: string[]
  /** Any CIK that owns a copy of the filing; used to build the archive URL. */
  pathCik: string
  indexUrl: string
}

const FEED_URL =
  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&output=atom"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "entry" || name === "link" || name === "category",
})

type Attr = Record<string, string>
type RawEntry = {
  title?: string
  link?: Attr[]
  summary?: { "#text"?: string } | string
  updated?: string
  category?: Attr[]
  id?: string
}

function parseTitle(title: string): {
  formType: string
  entityName: string
  cik: string
  role: FeedEntry["role"]
} {
  // "4 - Ault & Company, Inc. (0001734770) (Reporting)"
  const m = title.match(
    /^(.+?)\s+-\s+(.*)\s+\((\d{10})\)\s+\((Issuer|Reporting)\)\s*$/
  )
  if (m)
    return {
      formType: m[1].trim(),
      entityName: m[2].trim(),
      cik: m[3],
      role: m[4] as FeedEntry["role"],
    }
  const loose = title.match(/^(.+?)\s+-\s+(.*)$/)
  return {
    formType: loose?.[1]?.trim() ?? title,
    entityName: loose?.[2]?.trim() ?? "",
    cik: "",
    role: "Unknown",
  }
}

export function parseAtomFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml)
  const entries: RawEntry[] = doc?.feed?.entry ?? []
  const out: FeedEntry[] = []
  for (const e of entries) {
    const title = String(e.title ?? "")
    const { formType, entityName, cik, role } = parseTitle(title)
    const href =
      e.link?.find((l) => l["@_rel"] === "alternate")?.["@_href"] ??
      e.link?.[0]?.["@_href"] ??
      ""
    const idMatch = String(e.id ?? "").match(/accession-number=([\d-]+)/)
    const summary =
      typeof e.summary === "string" ? e.summary : (e.summary?.["#text"] ?? "")
    const accFromSummary = summary.match(/AccNo:<\/b>\s*([\d-]+)/)?.[1]
    const accession =
      idMatch?.[1] ??
      accFromSummary ??
      href.match(/(\d{10}-\d{2}-\d{6})-index/)?.[1]
    if (!accession) continue
    const filedDate =
      summary.match(/Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
    const updated = String(e.updated ?? "")
    const updatedMs = Date.parse(updated)
    const termType = e.category?.find((c) => c["@_label"] === "form type")?.[
      "@_term"
    ]
    out.push({
      accession,
      formType: termType ?? formType,
      cik: cik || (href.match(/\/data\/(\d+)\//)?.[1] ?? ""),
      entityName,
      role,
      updated,
      updatedMs: Number.isFinite(updatedMs) ? updatedMs : 0,
      filedDate,
      indexUrl: href,
    })
  }
  return out
}

export function groupEntries(entries: FeedEntry[]): Map<string, FeedFiling> {
  const map = new Map<string, FeedFiling>()
  for (const e of entries) {
    let f = map.get(e.accession)
    if (!f) {
      f = {
        accession: e.accession,
        formType: e.formType,
        updated: e.updated,
        updatedMs: e.updatedMs,
        filedDate: e.filedDate,
        issuerCik: null,
        issuerName: null,
        reportingCiks: [],
        reportingNames: [],
        pathCik: e.cik,
        indexUrl: e.indexUrl,
      }
      map.set(e.accession, f)
    }
    if (e.role === "Issuer") {
      f.issuerCik = e.cik
      f.issuerName = e.entityName
      f.pathCik = e.cik || f.pathCik
      f.indexUrl = e.indexUrl || f.indexUrl
    } else if (e.role === "Reporting") {
      if (e.cik && !f.reportingCiks.includes(e.cik)) {
        f.reportingCiks.push(e.cik)
        f.reportingNames.push(e.entityName)
      }
    }
    if (!f.pathCik && e.cik) f.pathCik = e.cik
  }
  return map
}

export interface FeedDeltaResult {
  filings: FeedFiling[]
  entriesSeen: number
  pagesFetched: number
  reachedCursor: boolean
}

/**
 * Cursor-based delta read of the "latest filings" feed. Pages newest -> oldest and stops once
 * an entry older than the cursor timestamp is seen. Returns filings strictly newer than the cursor,
 * oldest first, so callers can advance the cursor incrementally.
 */
export async function fetchFeedDelta(opts: {
  cursorMs: number
  maxPages: number
  pageSize?: number
  onPage?: (page: number, entries: number) => void
}): Promise<FeedDeltaResult> {
  const pageSize = opts.pageSize ?? 100
  const all: FeedEntry[] = []
  let pages = 0
  let reachedCursor = false
  for (let start = 0; pages < opts.maxPages; start += pageSize) {
    const xml = await secText(`${FEED_URL}&count=${pageSize}&start=${start}`)
    const entries = parseAtomFeed(xml)
    pages += 1
    opts.onPage?.(pages, entries.length)
    if (entries.length === 0) break
    for (const e of entries) {
      if (e.updatedMs <= opts.cursorMs) {
        reachedCursor = true
        continue
      }
      all.push(e)
    }
    if (reachedCursor) break
  }
  const grouped = groupEntries(all.filter((e) => e.formType === "4"))
  const filings = [...grouped.values()].sort(
    (a, b) =>
      a.updatedMs - b.updatedMs || a.accession.localeCompare(b.accession)
  )
  return {
    filings,
    entriesSeen: all.length,
    pagesFetched: pages,
    reachedCursor,
  }
}
