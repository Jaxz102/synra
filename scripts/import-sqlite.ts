/**
 * One-off import of the legacy SQLite database into Postgres: `bun run scripts/import-sqlite.ts [data/synra.db]`.
 * Idempotent (upserts by primary key). Run `bun run db:migrate` first. Safe to delete once the SQLite file is gone.
 */
import { Database } from "bun:sqlite"
import { sql } from "drizzle-orm"

import {
  filings,
  form4Cache,
  getDb,
  insiderAnalyses,
  insiders,
  issuerCache,
  kv,
  pollRuns,
  stocks,
  trades,
  type FilingStatus,
  type TradeHistory,
  type TradeTransaction,
} from "@/lib/db"
import { cikPadded } from "@/lib/sec/client"
import type { Form4 } from "@/lib/sec/form4"
import type { IssuerProfile } from "@/lib/sec/issuer"

const path = process.argv[2] ?? "data/synra.db"
const lite = new Database(path, { readonly: true })
const db = getDb()
const date = (s: string | null) => (s ? new Date(s) : null)
const json = <T>(s: string | null) => (s ? (JSON.parse(s) as T) : null)
const chunks = <T>(arr: T[], n = 200) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n)
  )

type Row = Record<string, string | number | null>
const all = (q: string) => lite.query<Row, []>(q).all()
const str = (v: string | number | null) => (v === null ? null : String(v))
const num = (v: string | number | null) => (v === null ? null : Number(v))

// kv
for (const r of all("SELECT key, value FROM kv")) {
  await db
    .insert(kv)
    .values({ key: r.key as string, value: r.value as string })
    .onConflictDoUpdate({ target: kv.key, set: { value: r.value as string } })
}

// poll_runs (keep ids so filings.run_id stays valid)
const runs = all("SELECT * FROM poll_runs ORDER BY id")
for (const c of chunks(runs)) {
  await db
    .insert(pollRuns)
    .values(
      c.map((r) => ({
        id: r.id as number,
        trigger: r.trigger as "schedule" | "manual" | "cli",
        status: r.status as "running" | "success" | "error",
        startedAt: new Date(r.started_at as string),
        finishedAt: date(str(r.finished_at)),
        cursorBefore: str(r.cursor_before),
        cursorAfter: str(r.cursor_after),
        feedEntries: r.feed_entries as number,
        newFilings: r.new_filings as number,
        skipped10b51: r.skipped_10b5_1 as number,
        skippedSell: r.skipped_sell as number,
        skippedNotPurchase: r.skipped_not_purchase as number,
        skippedRoutine: r.skipped_routine as number,
        posted: r.posted as number,
        errors: r.errors as number,
        error: str(r.error),
      }))
    )
    .onConflictDoNothing()
}
await db.execute(
  sql`SELECT setval(pg_get_serial_sequence('poll_runs', 'id'), COALESCE((SELECT MAX(id) FROM poll_runs), 0) + 1, false)`
)

// filings
const runIds = new Set(runs.map((r) => r.id))
const filingRows = all("SELECT * FROM filings")
for (const c of chunks(filingRows, 100)) {
  await db
    .insert(filings)
    .values(
      c.map((r) => ({
        accession: r.accession as string,
        cik: r.cik as string,
        issuerCik: str(r.issuer_cik),
        issuerName: str(r.issuer_name),
        ticker: str(r.ticker),
        insiderCik: str(r.insider_cik),
        insiderName: str(r.insider_name),
        insiderRole: str(r.insider_role),
        feedUpdated: new Date(r.feed_updated as string),
        filedDate: str(r.filed_date),
        periodOfReport: str(r.period_of_report),
        status: r.status as FilingStatus,
        reason: str(r.reason),
        runId: runIds.has(r.run_id) ? (r.run_id as number) : null,
        attempts: r.attempts as number,
        processedAt: date(str(r.processed_at)),
        indexUrl: str(r.index_url),
        xmlUrl: str(r.xml_url),
        form: json<Form4>(str(r.form_json)),
      }))
    )
    .onConflictDoNothing()
}

// caches
for (const c of chunks(all("SELECT * FROM form4_cache"), 100)) {
  await db
    .insert(form4Cache)
    .values(
      c.map((r) => ({
        accession: r.accession as string,
        fetchedAt: new Date(r.fetched_at as string),
        form: JSON.parse(r.json as string) as Form4,
      }))
    )
    .onConflictDoNothing()
}
for (const c of chunks(all("SELECT * FROM issuer_cache"))) {
  await db
    .insert(issuerCache)
    .values(
      c.map((r) => ({
        cik: r.cik as string,
        fetchedAt: new Date(r.fetched_at as string),
        profile: JSON.parse(r.json as string) as IssuerProfile,
      }))
    )
    .onConflictDoNothing()
}
const issuerProfiles = new Map(
  all("SELECT cik, json FROM issuer_cache").map((r) => [
    r.cik as string,
    JSON.parse(r.json as string) as IssuerProfile,
  ])
)

// analyses
for (const c of chunks(
  all("SELECT * FROM insider_analyses ORDER BY id"),
  100
)) {
  await db
    .insert(insiderAnalyses)
    .values(
      c.map((r) => ({
        id: r.id as number,
        accession: r.accession as string,
        insiderCik: r.insider_cik as string,
        issuerCik: str(r.issuer_cik),
        createdAt: new Date(r.created_at as string),
        model: r.model as string,
        classification: r.classification as string,
        confidence: num(r.confidence),
        reasoning: str(r.reasoning),
        patternSummary: str(r.pattern_summary),
        history: json<TradeHistory>(str(r.history_json)),
        promptTokens: num(r.prompt_tokens),
        completionTokens: num(r.completion_tokens),
      }))
    )
    .onConflictDoNothing()
}
await db.execute(
  sql`SELECT setval(pg_get_serial_sequence('insider_analyses', 'id'), COALESCE((SELECT MAX(id) FROM insider_analyses), 0) + 1, false)`
)

// trades → stocks + insiders + trades
function relationshipOf(
  form: Form4 | null,
  fallbackRole: string | null
): { title: string | null; relationship: string | null } {
  const o = form?.owners[0]
  if (!o) return { title: fallbackRole, relationship: null }
  const rel: string[] = []
  if (o.isOfficer) rel.push("Officer")
  if (o.isDirector) rel.push("Director")
  if (o.isTenPercentOwner) rel.push("10% Owner")
  if (o.isOther) rel.push("Other")
  return {
    title: o.officerTitle ?? o.otherText ?? (o.isDirector ? "Director" : null),
    relationship: rel.join(", ") || null,
  }
}
const tradeRows = all(
  "SELECT t.*, f.form_json FROM trades t LEFT JOIN filings f ON f.accession = t.accession ORDER BY t.id"
)
let imported = 0
for (const r of tradeRows) {
  if (!r.issuer_cik || !r.insider_cik) {
    console.warn(`skip ${r.accession}: missing CIK`)
    continue
  }
  const form = json<Form4>(str(r.form_json))
  const stockId = cikPadded(r.issuer_cik as string)
  const insiderId = cikPadded(r.insider_cik as string)
  const profile = issuerProfiles.get(stockId)
  const { title, relationship } = relationshipOf(form, str(r.insider_role))
  const tradeRow = {
    insiderId,
    stockId,
    tradeType: "purchase",
    shares: Math.round(r.shares as number),
    pricePerShare:
      r.avg_price === null ? null : Number((r.avg_price as number).toFixed(4)),
    totalValue:
      r.value === null ? null : Number((r.value as number).toFixed(2)),
    tradeDate: str(r.trade_date) ?? form?.periodOfReport ?? null,
    filingDate: str(r.filed_date) ?? form?.signatureDate ?? null,
    postedAt: new Date(r.posted_at as string),
    sharesAfter: num(r.shares_after),
    transactions: JSON.parse(
      r.transactions_json as string
    ) as TradeTransaction[],
    aiClassification: str(r.ai_classification),
    aiConfidence: num(r.ai_confidence),
    aiReasoning: str(r.ai_reasoning),
    aiPattern: str(r.ai_pattern),
    aiModel: str(r.ai_model),
    history: json<TradeHistory>(str(r.history_json)),
    filingUrl: str(r.filing_url),
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(stocks)
      .values({
        id: stockId,
        ticker: str(r.ticker),
        companyName: str(r.issuer_name) ?? stockId,
        exchange: profile?.exchanges.join(", ") || null,
        sector: profile?.sicDescription ?? null,
      })
      .onConflictDoNothing()
    await tx
      .insert(insiders)
      .values({
        id: insiderId,
        name: str(r.insider_name) ?? insiderId,
        title,
        relationship,
        company: str(r.issuer_name),
      })
      .onConflictDoNothing()
    await tx
      .insert(trades)
      .values({ id: r.accession as string, ...tradeRow })
      .onConflictDoUpdate({ target: trades.id, set: tradeRow })
  })
  imported += 1
}

console.log(
  JSON.stringify(
    {
      kv: 2,
      runs: runs.length,
      filings: filingRows.length,
      analyses: 123,
      trades: imported,
    },
    null,
    2
  )
)
await db.$client.close()
