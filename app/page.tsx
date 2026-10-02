import Image from "next/image"

import { PipelineTable } from "@/components/dashboard/pipeline-table"
import { PollControls } from "@/components/dashboard/poll-controls"
import { RunsTable } from "@/components/dashboard/runs-table"
import { SignalsTable } from "@/components/dashboard/signals-table"
import { StatTiles } from "@/components/dashboard/stat-tiles"
import { ThemeToggle } from "@/components/theme-toggle"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getPollStatus,
  getStats,
  listFilings,
  listRuns,
  listTrades,
} from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [stats, trades, filings, runs, status] = await Promise.all([
    getStats(),
    listTrades(),
    listFilings(),
    listRuns(),
    getPollStatus(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Synra logo"
            width={36}
            height={36}
            loading="eager"
            className="size-9"
          />
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Synra
            </h1>
            <p className="text-sm text-muted-foreground">
              Unplanned insider buying, surfaced from SEC Form 4 filings.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PollControls status={status} />
          <ThemeToggle />
        </div>
      </header>

      <StatTiles stats={stats} />

      <Tabs defaultValue="signals" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline log</TabsTrigger>
            <TabsTrigger value="runs">Poll runs</TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">
            Every {status.intervalHours}h · cursor{" "}
            {status.cursor
              ? new Date(status.cursor).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "not set"}
          </p>
        </div>
        <TabsContent value="signals">
          <SignalsTable trades={trades} scanned={stats.scanned} />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineTable filings={filings} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTable runs={runs} />
        </TabsContent>
      </Tabs>

      <footer className="text-xs text-muted-foreground">
        Screens Form 4 filings from the SEC EDGAR latest-filings feed. Keeps
        open-market purchases outside Rule 10b5-1 plans, in NYSE or Nasdaq
        stocks worth at least $100M, by insiders whose last three years of
        trading show no routine calendar month, and only while the price is
        within 2% of the insider&apos;s; each one is bought with an Alpaca paper
        market order and posted once it fills. Not investment advice.
      </footer>
    </div>
  )
}
