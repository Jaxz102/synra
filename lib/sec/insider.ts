import { eq } from "drizzle-orm"

import { form4Cache, getDb } from "@/lib/db"
import {
  accessionNoDash,
  cikNoPad,
  cikPadded,
  filingIndexHtmlUrl,
  SEC_ARCHIVES,
  SecHttpError,
  secJson,
  secText,
} from "@/lib/sec/client"
import { type Form4, parseForm4Xml } from "@/lib/sec/form4"

/** Columnar filing list, as in `filings.recent` and the older `filings.files` pages. */
interface FilingColumns {
  accessionNumber: string[]
  filingDate: string[]
  reportDate: string[]
  form: string[]
  primaryDocument: string[]
}

interface Submissions {
  cik: string
  name: string
  filings: {
    recent: FilingColumns
    files?: { name: string; filingFrom: string; filingTo: string }[]
  }
}

export interface InsiderFilingRef {
  accession: string
  filingDate: string
  reportDate: string | null
  form: string
  primaryDocument: string
}

/**
 * The insider's Form 4s that can hold transactions dated in each of `months` ("YYYY-MM"), keyed by month. A filing's
 * transactions fall between its period of report and its filing date, so filings overlapping a month are kept.
 * `recent` holds the latest ~1000 filings; heavier filers spill into older pages, which are fetched when they reach
 * into a month.
 */
export async function listInsiderForm4s(
  ownerCik: string,
  months: string[]
): Promise<Record<string, InsiderFilingRef[]>> {
  const subs = await secJson<Submissions>(
    `https://data.sec.gov/submissions/CIK${cikPadded(ownerCik)}.json`
  )
  // Dates compare as strings, so day 31 closes every month.
  const windows = months.map((m) => ({ m, from: `${m}-01`, to: `${m}-31` }))
  const earliest = windows.map((w) => w.from).sort()[0]
  const pages = [subs.filings.recent]
  for (const f of subs.filings.files ?? [])
    if (f.filingTo >= earliest)
      pages.push(
        await secJson<FilingColumns>(
          `https://data.sec.gov/submissions/${f.name}`
        )
      )
  const out = Object.fromEntries(
    months.map((m) => [m, [] as InsiderFilingRef[]])
  )
  for (const r of pages) {
    for (let i = 0; i < r.accessionNumber.length; i++) {
      if (r.form[i] !== "4") continue
      const reportDate = r.reportDate[i] || null
      const filingDate = r.filingDate[i]
      for (const w of windows)
        if ((reportDate ?? filingDate) <= w.to && filingDate >= w.from)
          out[w.m].push({
            accession: r.accessionNumber[i],
            filingDate,
            reportDate,
            form: r.form[i],
            primaryDocument: r.primaryDocument[i],
          })
    }
  }
  return out
}

async function cacheGet(accession: string): Promise<Form4 | null> {
  const [row] = await getDb()
    .select({ form: form4Cache.form })
    .from(form4Cache)
    .where(eq(form4Cache.accession, accession))
  return row?.form ?? null
}

async function cachePut(form: Form4): Promise<void> {
  await getDb()
    .insert(form4Cache)
    .values({ accession: form.accession, form })
    .onConflictDoUpdate({
      target: form4Cache.accession,
      set: { form, fetchedAt: new Date() },
    })
}

export function cacheForm4(form: Form4): Promise<void> {
  return cachePut(form)
}

/**
 * Fetches and parses one historical Form 4 (cached in Postgres), or returns null when the document is missing or not an ownership XML.
 * Network and throttling errors propagate: a silently dropped filing could flip the insider criteria.
 */
export async function fetchHistoricalForm4(
  ownerCik: string,
  ref: InsiderFilingRef
): Promise<Form4 | null> {
  const cached = await cacheGet(ref.accession)
  if (cached) return cached
  // primaryDocument looks like "xslF345X06/ownership.xml"; the raw XML lives at the un-styled path.
  const doc = ref.primaryDocument.replace(/^xsl[^/]*\//i, "")
  const base = `${SEC_ARCHIVES}/${cikNoPad(ownerCik)}/${accessionNoDash(ref.accession)}`
  const xmlUrl = `${base}/${doc}`
  const skip = (err: unknown) => {
    console.warn(
      `[synra] skipping historical Form 4 ${ref.accession}: ${(err as Error).message}`
    )
    return null
  }
  let xml: string
  try {
    xml = await secText(xmlUrl)
  } catch (err) {
    if (err instanceof SecHttpError && err.status === 404) return skip(err)
    throw err
  }
  let form: Form4
  try {
    form = parseForm4Xml(xml, {
      accession: ref.accession,
      xmlUrl,
      indexUrl: filingIndexHtmlUrl(ownerCik, ref.accession),
    })
  } catch (err) {
    return skip(err)
  }
  await cachePut(form)
  return form
}
