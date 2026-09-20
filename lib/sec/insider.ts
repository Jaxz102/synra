import { eq } from "drizzle-orm"

import { form4Cache, getDb } from "@/lib/db"
import { env } from "@/lib/env"
import {
  accessionNoDash,
  cikNoPad,
  cikPadded,
  filingIndexHtmlUrl,
  SEC_ARCHIVES,
  secJson,
  secText,
} from "@/lib/sec/client"
import { type Form4, parseForm4Xml } from "@/lib/sec/form4"

interface Submissions {
  cik: string
  name: string
  filings: {
    recent: {
      accessionNumber: string[]
      filingDate: string[]
      reportDate: string[]
      form: string[]
      primaryDocument: string[]
    }
  }
}

export interface InsiderFilingRef {
  accession: string
  filingDate: string
  reportDate: string | null
  form: string
  primaryDocument: string
}

export async function listInsiderForm4s(
  ownerCik: string,
  opts: { months: number; max: number; exclude?: string }
): Promise<InsiderFilingRef[]> {
  const subs = await secJson<Submissions>(
    `https://data.sec.gov/submissions/CIK${cikPadded(ownerCik)}.json`
  )
  const r = subs.filings.recent
  const since = new Date()
  since.setMonth(since.getMonth() - opts.months)
  const sinceStr = since.toISOString().slice(0, 10)
  const out: InsiderFilingRef[] = []
  for (let i = 0; i < r.accessionNumber.length; i++) {
    if (r.form[i] !== "4") continue
    if (r.accessionNumber[i] === opts.exclude) continue
    if (r.filingDate[i] < sinceStr) continue
    out.push({
      accession: r.accessionNumber[i],
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i] || null,
      form: r.form[i],
      primaryDocument: r.primaryDocument[i],
    })
    if (out.length >= opts.max) break
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

async function fetchHistoricalForm4(
  ownerCik: string,
  ref: InsiderFilingRef
): Promise<Form4> {
  const cached = await cacheGet(ref.accession)
  if (cached) return cached
  // primaryDocument looks like "xslF345X06/ownership.xml"; the raw XML lives at the un-styled path.
  const doc = ref.primaryDocument.replace(/^xsl[^/]*\//i, "")
  const base = `${SEC_ARCHIVES}/${cikNoPad(ownerCik)}/${accessionNoDash(ref.accession)}`
  const xmlUrl = `${base}/${doc}`
  const xml = await secText(xmlUrl)
  const form = parseForm4Xml(xml, {
    accession: ref.accession,
    xmlUrl,
    indexUrl: filingIndexHtmlUrl(ownerCik, ref.accession),
  })
  await cachePut(form)
  return form
}

/** Prior Form 4s for an insider, oldest first. */
export async function getInsiderHistory(
  ownerCik: string,
  excludeAccession: string
): Promise<Form4[]> {
  const refs = await listInsiderForm4s(ownerCik, {
    months: env.historyMonths,
    max: env.historyMaxFilings,
    exclude: excludeAccession,
  })
  const forms: Form4[] = []
  for (const ref of refs) {
    try {
      forms.push(await fetchHistoricalForm4(ownerCik, ref))
    } catch (err) {
      console.warn(
        `[synra] could not load historical Form 4 ${ref.accession}: ${(err as Error).message}`
      )
    }
  }
  return forms.sort((a, b) =>
    (a.periodOfReport ?? "").localeCompare(b.periodOfReport ?? "")
  )
}
