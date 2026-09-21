import { env } from "@/lib/env"
import { currentRun, runPoll } from "@/lib/pipeline/poll"

export const dynamic = "force-dynamic"
// A full run (feed pages → per-filing SEC fetches → Grok → Alpaca) can take minutes.
export const maxDuration = 300

/**
 * Vercel Cron entry point (see vercel.json). Vercel sends a GET with
 * `Authorization: Bearer $CRON_SECRET`; the in-process scheduler is not viable on
 * serverless, so this awaits the run so the function is not frozen mid-poll.
 */
export async function GET(req: Request) {
  if (!env.cronSecret) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 })
  }
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (currentRun()) {
    return Response.json(
      { started: false, reason: "A poll run is already in progress" },
      { status: 409 }
    )
  }
  const result = await runPoll("schedule")
  return Response.json({ started: true, ...result })
}
