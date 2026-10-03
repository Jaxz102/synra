import { after } from "next/server"

import { env } from "@/lib/env"
import { closeStaleRuns, currentRun, runPoll } from "@/lib/pipeline/poll"

export const dynamic = "force-dynamic"
// The run continues in `after()` once the response is sent; it is still bounded by this limit.
export const maxDuration = 300
/** Stop starting new filings this long into the invocation, leaving room for one filing (incl. a fill wait) to finish. */
const RUN_BUDGET_MS = 220_000

export async function GET(req: Request) {
  if (!env.cronSecret) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 })
  }
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (currentRun()) {
    await closeStaleRuns()
    return Response.json(
      { started: false, reason: "A poll run is already in progress" },
      { status: 409 }
    )
  }
  const deadline = Date.now() + RUN_BUDGET_MS
  after(async () => {
    try {
      await runPoll("schedule", { deadline })
    } catch (err) {
      console.error(`[synra] cron poll failed: ${(err as Error).message}`)
    }
  })
  return Response.json({ started: true }, { status: 202 })
}
