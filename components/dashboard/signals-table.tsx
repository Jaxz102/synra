"use client"

import { ExternalLink } from "lucide-react"
import * as React from "react"

import { TradeDialog } from "@/components/dashboard/trade-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtDate, fmtInt, fmtMoney, fmtPct, fmtRelative } from "@/lib/format"
import type { Trade } from "@/lib/queries"

export function SignalsTable({
  trades,
  scanned,
}: {
  trades: Trade[]
  scanned: number
}) {
  const [open, setOpen] = React.useState<Trade | null>(null)

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center">
        <p className="font-heading text-lg font-semibold">No signals yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Synra has screened {fmtInt(scanned)} Form 4 filings. Unplanned
          open-market purchases that Grok judges to be non-routine will appear
          here after the next poll.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Insider</TableHead>
              <TableHead>Last buy</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Avg price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Held after</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Posted</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() => setOpen(t)}
              >
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-semibold">{t.ticker ?? "—"}</span>
                    <span className="max-w-56 truncate text-xs text-muted-foreground">
                      {t.issuerName}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{t.insiderName}</span>
                    <span className="max-w-56 truncate text-xs text-muted-foreground">
                      {t.insiderRole}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {fmtDate(t.tradeDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtInt(t.shares)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMoney(t.pricePerShare, 2)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtMoney(t.totalValue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtInt(t.sharesAfter)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="border-transparent bg-primary/15 text-primary dark:bg-primary/25 dark:text-primary-foreground"
                  >
                    {t.aiClassification === "opportunistic"
                      ? "Opportunistic"
                      : t.aiClassification}{" "}
                    · {fmtPct(t.aiConfidence)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {fmtRelative(t.postedAt)}
                </TableCell>
                <TableCell>
                  {t.filingUrl && (
                    <a
                      href={t.filingUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open SEC filing"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TradeDialog trade={open} onClose={() => setOpen(null)} />
    </>
  )
}
