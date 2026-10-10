import { eq } from "drizzle-orm"

import { type Db, getDb, insiderAnalyses, insiders, keep, now } from "@/lib/db"
import {
  CLASSIFIER,
  type InsiderEvaluation,
  lookupInsider,
} from "@/lib/pipeline/insider-criteria"
import { cikPadded } from "@/lib/sec/client"
import type { Form4 } from "@/lib/sec/form4"

/** The database or an open transaction. */
type Writer = Pick<Db, "insert">

export interface InsiderRow {
  /** Padded reporting-owner CIK. */
  id: string
  name: string
  title: string | null
  relationship: string | null
  company: string | null
}

/** The `insiders` row for the filing's first reporting owner. */
export function insiderRow(form: Form4): InsiderRow {
  const o = form.owners[0]
  if (!o?.cik) throw new Error("Form 4 has no reporting owner CIK")
  const id = cikPadded(o.cik)
  const rel: string[] = []
  if (o.isOfficer) rel.push("Officer")
  if (o.isDirector) rel.push("Director")
  if (o.isTenPercentOwner) rel.push("10% Owner")
  if (o.isOther) rel.push("Other")
  return {
    id,
    name: o.name ?? id,
    title: o.officerTitle ?? o.otherText ?? (o.isDirector ? "Director" : null),
    relationship: rel.join(", ") || null,
    company: form.issuer.name,
  }
}

/**
 * Inserts or refreshes the insider's profile, keeping known fields the filing lacks. The routine/opportunistic label
 * is only written when `label` is given, which `insiderVerdict` does once per insider.
 */
export async function upsertInsider(
  db: Writer,
  row: InsiderRow,
  label?: InsiderEvaluation
) {
  const labelCols = label && {
    traderType: label.verdict,
    traderEvaluation: label,
    traderClassifiedAt: new Date(),
  }
  await db
    .insert(insiders)
    .values({ ...row, ...labelCols })
    .onConflictDoUpdate({
      target: insiders.id,
      set: {
        name: row.name,
        title: keep(insiders.title, row.title),
        relationship: keep(insiders.relationship, row.relationship),
        company: keep(insiders.company, row.company),
        updatedAt: now,
        ...labelCols,
      },
    })
}

async function recordAnalysis(
  db: Writer,
  form: Form4,
  insiderCik: string,
  evaluation: InsiderEvaluation,
  classifier: string
) {
  await db.insert(insiderAnalyses).values({
    accession: form.accession,
    insiderCik,
    issuerCik: form.issuer.cik,
    classifier,
    classification: evaluation.verdict,
    patternSummary: evaluation.summary,
    history: { trades: evaluation.trades },
  })
}

/**
 * Step 5: the insider's routine/opportunistic/ineligible label. The first of their filings to reach step 5 runs the
 * lookup and stores the result on their `insiders` row; the label never changes after that, so later filings reuse
 * it without touching SEC. A label stored by an older rule (another `classifier`) is recomputed once. Every
 * evaluation is logged to `insider_analyses`.
 */
export async function insiderVerdict(
  form: Form4,
  tradeDate: string
): Promise<InsiderEvaluation> {
  const row = insiderRow(form)
  const db = getDb()
  const [stored] = await db
    .select({ evaluation: insiders.traderEvaluation })
    .from(insiders)
    .where(eq(insiders.id, row.id))
  if (stored?.evaluation?.classifier === CLASSIFIER) {
    await recordAnalysis(
      db,
      form,
      row.id,
      stored.evaluation,
      `${CLASSIFIER}:stored`
    )
    return stored.evaluation
  }
  const evaluation = await lookupInsider(row.id, tradeDate)
  await db.transaction(async (tx) => {
    await upsertInsider(tx, row, evaluation)
    await recordAnalysis(tx, form, row.id, evaluation, CLASSIFIER)
  })
  return evaluation
}
