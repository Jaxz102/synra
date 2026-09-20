"use client"

import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtDate, fmtInt, fmtMoney, fmtPct } from "@/lib/format"
import type { Trade } from "@/lib/queries"

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function TradeDialog({
  trade,
  onClose,
}: {
  trade: Trade | null
  onClose: () => void
}) {
  const t = trade
  const stats = t?.history?.stats
  const prior = t?.history?.filings ?? []
  return (
    <Dialog open={!!t} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {t && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 font-heading">
                <span>{t.ticker ?? t.issuerName}</span>
                <span className="font-normal text-muted-foreground">
                  {t.issuerName}
                </span>
              </DialogTitle>
              <DialogDescription>
                {t.insiderName} · {t.insiderRole} · filed{" "}
                {fmtDate(t.filingDate)}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Last buy" value={fmtDate(t.tradeDate)} />
              <Fact label="Shares bought" value={fmtInt(t.shares)} />
              <Fact label="Avg price" value={fmtMoney(t.pricePerShare, 2)} />
              <Fact label="Value" value={fmtMoney(t.totalValue)} />
              <Fact label="Held after" value={fmtInt(t.sharesAfter)} />
              <Fact
                label="Prior filings"
                value={fmtInt(stats?.priorFilings ?? 0)}
              />
              <Fact
                label="Prior open-market buys"
                value={fmtInt(stats?.priorOpenMarketBuys ?? 0)}
              />
              <Fact
                label="Median days between buys"
                value={
                  stats?.medianDaysBetweenBuys === null ||
                  stats?.medianDaysBetweenBuys === undefined
                    ? "—"
                    : fmtInt(stats.medianDaysBetweenBuys)
                }
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-transparent bg-primary/15 text-primary dark:bg-primary/25 dark:text-primary-foreground"
                >
                  Opportunistic · {fmtPct(t.aiConfidence)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t.aiModel}
                </span>
              </div>
              {t.aiPattern && (
                <p className="text-sm font-medium">{t.aiPattern}</p>
              )}
              {t.aiReasoning && (
                <p className="text-sm text-muted-foreground">{t.aiReasoning}</p>
              )}
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">
                Purchases on this filing
              </h4>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Security</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">After</TableHead>
                      <TableHead>Ownership</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {t.transactions.map((x, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {fmtDate(x.date)}
                        </TableCell>
                        <TableCell>
                          <div>{x.securityTitle}</div>
                          {x.footnotes.length > 0 && (
                            <div className="max-w-md text-xs text-muted-foreground">
                              {x.footnotes.join(" ")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(x.shares)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoney(x.pricePerShare, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(x.sharesAfter)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {x.ownership === "I"
                            ? `Indirect${x.natureOfOwnership ? ` · ${x.natureOfOwnership}` : ""}`
                            : "Direct"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {prior.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold">
                  Insider&apos;s prior Form 4 history reviewed by Grok
                </h4>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Issuer</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prior.flatMap((f) =>
                        (f.transactions.length ? f.transactions : [null]).map(
                          (x, i) => (
                            <TableRow key={`${f.accession}-${i}`}>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {fmtDate(x?.date ?? f.reportDate)}
                              </TableCell>
                              <TableCell>{f.ticker ?? f.issuer}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {x
                                  ? `${x.code ?? "?"} / ${x.acquiredDisposed ?? ""}${x.derivative ? " (deriv)" : ""}`
                                  : "holdings only"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtInt(x?.shares)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtMoney(x?.price, 2)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {f.aff10b5One
                                  ? "10b5-1"
                                  : f.mentions10b5InFootnotes
                                    ? "10b5-1 (footnote)"
                                    : ""}
                              </TableCell>
                            </TableRow>
                          )
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {t.filingUrl && (
              <div>
                <Button asChild variant="outline" size="sm">
                  <a href={t.filingUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> View filing on SEC.gov
                  </a>
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
