import { kvGet } from "@/lib/db"
import { env } from "@/lib/env"
import { currentRun, LAST_RUN_KEY, runPoll } from "@/lib/pipeline/poll"

type G = typeof globalThis & {
  __synraScheduler?: {
    timer: ReturnType<typeof setTimeout> | null
    nextRunAt: number | null
    started: boolean
  }
}

function state() {
  const g = globalThis as G
  if (!g.__synraScheduler)
    g.__synraScheduler = { timer: null, nextRunAt: null, started: false }
  return g.__synraScheduler
}

export function intervalMs(): number {
  return env.pollIntervalHours * 3_600_000
}

export function nextScheduledRunAt(): number | null {
  return state().nextRunAt
}

function schedule(delayMs: number) {
  const s = state()
  if (s.timer) clearTimeout(s.timer)
  s.nextRunAt = Date.now() + delayMs
  s.timer = setTimeout(async () => {
    s.timer = null
    if (!currentRun()) {
      try {
        await runPoll("schedule")
      } catch (err) {
        console.error("[synra] scheduled poll failed:", (err as Error).message)
      }
    }
    schedule(intervalMs())
  }, delayMs)
  // Do not keep the process alive just for the timer.
  ;(s.timer as { unref?: () => void }).unref?.()
}

/** Starts the 6-hourly poll loop once per process. Runs immediately if the last run is older than the interval. */
export async function startScheduler(): Promise<void> {
  const s = state()
  if (s.started) return
  s.started = true
  const last = await kvGet(LAST_RUN_KEY)
  const lastMs = last ? Date.parse(last) : 0
  const due = lastMs + intervalMs() - Date.now()
  const delay = Math.max(5_000, Math.min(due, intervalMs()))
  console.log(
    `[synra] scheduler armed: every ${env.pollIntervalHours}h, next run in ${Math.round(delay / 60_000)} min`
  )
  schedule(delay)
}

/** Kicks off a run right now (if none is active) and re-arms the schedule from this point. */
export function triggerNow(trigger: "manual" | "cli" = "manual"): {
  started: boolean
  reason?: string
} {
  if (currentRun())
    return { started: false, reason: "A poll run is already in progress" }
  runPoll(trigger).catch((err) =>
    console.error("[synra] manual poll failed:", (err as Error).message)
  )
  if (state().started) schedule(intervalMs())
  return { started: true }
}
