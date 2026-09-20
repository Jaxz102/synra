/**
 * One-off poll from the command line.
 *   bun run poll                 # full delta run
 *   bun run poll --limit 25      # process at most 25 filings
 *   bun run poll --lookback 48   # first-run lookback window in hours (only when no cursor exists)
 *   bun run poll --reset         # clear the cursor before running
 */
import { kvDelete, kvSet } from "@/lib/db"
import { CURSOR_KEY, runPoll } from "@/lib/pipeline/poll"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const limit = flag("limit") ? Number(flag("limit")) : undefined
const lookbackHours = flag("lookback") ? Number(flag("lookback")) : undefined
if (args.includes("--reset")) {
  await kvDelete(CURSOR_KEY)
  console.log("[synra] cursor cleared")
}
if (flag("cursor"))
  await kvSet(CURSOR_KEY, new Date(flag("cursor") as string).toISOString())

const { runId, counters } = await runPoll("cli", { limit, lookbackHours })
console.log(JSON.stringify({ runId, ...counters }, null, 2))
process.exit(0)
