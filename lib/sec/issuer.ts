import { eq } from "drizzle-orm"

import { getDb, issuerCache } from "@/lib/db"
import { cikPadded, secJson } from "@/lib/sec/client"

export interface IssuerProfile {
  cik: string
  name: string | null
  tickers: string[]
  exchanges: string[]
  sicDescription: string | null
}

interface IssuerSubmissions {
  cik: string
  name: string
  tickers?: string[]
  exchanges?: (string | null)[]
  sicDescription?: string
}

/** Issuer exchange/sector metadata from data.sec.gov, cached in Postgres. */
export async function getIssuerProfile(cik: string): Promise<IssuerProfile> {
  const key = cikPadded(cik)
  const db = getDb()
  const [cached] = await db
    .select({ profile: issuerCache.profile })
    .from(issuerCache)
    .where(eq(issuerCache.cik, key))
  if (cached) return cached.profile
  const subs = await secJson<IssuerSubmissions>(
    `https://data.sec.gov/submissions/CIK${key}.json`
  )
  const profile: IssuerProfile = {
    cik: key,
    name: subs.name ?? null,
    tickers: subs.tickers ?? [],
    exchanges: [
      ...new Set((subs.exchanges ?? []).filter((e): e is string => !!e)),
    ],
    sicDescription: subs.sicDescription?.trim() || null,
  }
  await db
    .insert(issuerCache)
    .values({ cik: key, profile })
    .onConflictDoUpdate({
      target: issuerCache.cik,
      set: { profile, fetchedAt: new Date() },
    })
  return profile
}
