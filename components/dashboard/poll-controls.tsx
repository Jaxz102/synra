"use client"

import { LoaderCircle, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { fmtRelative } from "@/lib/format"
import type { PollStatus } from "@/lib/queries"

export function PollControls({ initial }: { initial: PollStatus }) {
  const router = useRouter()
  const [status, setStatus] = React.useState<PollStatus>(initial)
  // Adopt a fresh server snapshot (after router.refresh()) during render rather than in an effect.
  const [prevInitial, setPrevInitial] = React.useState(initial)
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setStatus(initial)
  }
  const [busy, setBusy] = React.useState(false)
  const wasRunning = React.useRef<boolean>(!!initial.running)
  const [, tick] = React.useReducer((x: number) => x + 1, 0)

  // Keep the page live: poll status while a run is active, refresh data when it finishes, and re-render relative times.
  React.useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch("/api/poll", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const next = (await res.json()) as PollStatus
        setStatus(next)
        const running = !!next.running
        if (wasRunning.current && !running) {
          const r = next.lastRun
          if (r?.status === "success")
            toast.success(`Poll #${r.id} finished`, {
              description: `${r.posted} posted · ${r.skippedRoutine} routine · ${r.skipped10b51} 10b5-1 · ${r.skippedSell} sales · ${r.errors} errors`,
            })
          else if (r?.status === "error")
            toast.error(`Poll #${r.id} failed`, {
              description: r.error ?? undefined,
            })
          router.refresh()
        } else if (running) {
          router.refresh()
        }
        wasRunning.current = running
      } catch {
        /* transient */
      }
    }
    const id = setInterval(
      () => {
        tick()
        void check()
      },
      status.running ? 5_000 : 30_000
    )
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [router, status.running])

  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/poll", { method: "POST" })
      const body = (await res.json()) as {
        started: boolean
        reason?: string
        status: PollStatus
      }
      if (body.started) {
        toast("Poll started", {
          description: "Reading the SEC feed since the last cursor…",
        })
        wasRunning.current = true
        setStatus({
          ...body.status,
          running: body.status.running ?? {
            runId: -1,
            startedAt: new Date().toISOString(),
          },
        })
      } else {
        toast.warning(body.reason ?? "Could not start poll")
      }
    } catch (err) {
      toast.error("Request failed", { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const running = !!status.running
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-xs leading-tight text-muted-foreground sm:block">
        <div>
          Last poll{" "}
          <span className="text-foreground">
            {fmtRelative(status.lastRunStartedAt)}
          </span>
        </div>
        <div>
          {status.schedulerEnabled ? (
            status.nextRunAt ? (
              <>
                Next{" "}
                <span className="text-foreground">
                  {fmtRelative(status.nextRunAt)}
                </span>{" "}
                · every {status.intervalHours}h
              </>
            ) : (
              <>Scheduler every {status.intervalHours}h</>
            )
          ) : (
            "Scheduler off"
          )}
        </div>
      </div>
      <Button onClick={run} disabled={busy || running} variant="outline">
        {running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        {running ? "Polling…" : "Poll now"}
      </Button>
    </div>
  )
}
