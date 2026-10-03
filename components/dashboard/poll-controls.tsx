"use client"

import { LoaderCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { fmtRelative } from "@/lib/format"
import type { PollStatus } from "@/lib/queries"

/** Read-only poll status. Runs are triggered by GET /api/cron/poll (or `bun run poll` locally), not from the page. */
export function PollControls({ status }: { status: PollStatus }) {
  const router = useRouter()
  const running = !!status.running
  const [, tick] = React.useReducer((x: number) => x + 1, 0)

  // Keep the page live: re-render relative times and pull fresh server data, faster while a run is active.
  React.useEffect(() => {
    const id = setInterval(
      () => {
        tick()
        router.refresh()
      },
      running ? 5_000 : 60_000
    )
    return () => clearInterval(id)
  }, [router, running])

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
