import { Card, CardContent } from "@/components/ui/card"
import { fmtInt, fmtMoneyCompact } from "@/lib/format"
import type { Stats } from "@/lib/queries"

function Tile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span
          className={
            accent
              ? "font-heading text-3xl font-semibold text-primary"
              : "font-heading text-3xl font-semibold"
          }
        >
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </CardContent>
    </Card>
  )
}

export function StatTiles({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        label="Signals posted"
        value={fmtInt(stats.signals)}
        sub={`${fmtInt(stats.signals24h)} in last 24h · ${fmtMoneyCompact(stats.signalValue24h)} bought`}
        accent
      />
      <Tile
        label="Filings scanned"
        value={fmtInt(stats.scanned)}
        sub={`${fmtInt(stats.scanned24h)} in last 24h${stats.pending ? ` · ${fmtInt(stats.pending)} pending` : ""}`}
      />
      <Tile
        label="Skipped · 10b5-1 plans"
        value={fmtInt(stats.planned)}
        sub="Pre-scheduled trades"
      />
      <Tile
        label="Skipped · sales & other"
        value={fmtInt(stats.sells + stats.notPurchase)}
        sub={`${fmtInt(stats.sells)} sales · ${fmtInt(stats.notPurchase)} grants, exercises, gifts`}
      />
      <Tile
        label="Skipped · routine buys"
        value={fmtInt(stats.routine)}
        sub={
          stats.errors
            ? `Grok verdict · ${fmtInt(stats.errors)} errors`
            : "Grok verdict"
        }
      />
    </div>
  )
}
