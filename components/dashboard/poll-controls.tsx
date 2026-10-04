"use client"

import { LoaderCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { checkDashboard } from "@/app/actions"
import { fmtRelative } from "@/lib/format"
import type { PollStatus } from "@/lib/queries"

/** How often a visible page asks whether there is new data (a few hundred bytes per check). */
const CHECK_MS = 30_000

/** Read-only poll status. Runs are triggered by GET /api/cron/poll (or `bun run poll` locally), not from the page. */
export function PollControls({ status }: { status: PollStatus }) {
  const router = useRouter()
  const running = !!status.running
  const { version } = status
  const [, tick] = React.useReducer((x: number) => x + 1, 0)

  // Re-render relative times locally.
  React.useEffect(() => {
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // Pull fresh server data only when the data version or run state changed, and only while the tab is visible.
  React.useEffect(() => {
    let busy = false
    const check = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const next = await checkDashboard()
        if (next.version !== version || next.running !== running)
          router.refresh()
      } catch {
        // Offline or a deploy in progress; the next check retries.
      } finally {
        busy = false
      }
    }
    const id = setInterval(check, CHECK_MS)
    document.addEventListener("visibilitychange", check)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", check)
    }
  }, [router, running, version])

  return (
    <div className="hidden items-center gap-2 text-right text-xs leading-tight text-muted-foreground sm:flex">
      {running && <LoaderCircle className="size-4 animate-spin" />}
      <div>
        <div>
          {running ? (
            <span className="text-foreground">Polling…</span>
          ) : (
            <>
              Last poll{" "}
              <span className="text-foreground">
                {fmtRelative(status.lastRunStartedAt)}
              </span>
            </>
          )}
        </div>
        <div>Triggered by /api/cron/poll</div>
      </div>
    </div>
  )
}
