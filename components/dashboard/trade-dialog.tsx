"use client"

import { ExternalLink } from "lucide-react"
import * as React from "react"

import { loadTradeDetail } from "@/app/actions"
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
import { fmtDate, fmtInt, fmtMoney, fmtMoneyCompact } from "@/lib/format"
import type { Trade, TradeDetail } from "@/lib/queries"

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

/** Fractional fills come back like "19.230769"; whole-share fills stay integers. */
const fmtShares = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 4 })

type DetailState =
  | { status: "loading"; data?: undefined }
  | { status: "error"; data?: undefined }
  | { status: "ready"; data: TradeDetail }

/** Fetches the open trade's transactions and history; a response for a trade no longer open is dropped. */
function useTradeDetail(id: string | undefined): DetailState {
  const [state, setState] = React.useState<{
    id: string
    detail: DetailState
  } | null>(null)
  React.useEffect(() => {
    if (!id) return
    let live = true
    loadTradeDetail(id)
      .then((data) => {
        if (live)
          setState({
            id,
            detail: data ? { status: "ready", data } : { status: "error" },
          })
      })
      .catch(() => {
        if (live) setState({ id, detail: { status: "error" } })
      })
    return () => {
      live = false
    }
  }, [id])
  return state && state.id === id ? state.detail : { status: "loading" }
}

export function TradeDialog({
  trade,
  onClose,
}: {
  trade: Trade | null
  onClose: () => void
}) {
  const t = trade
  const detail = useTradeDetail(t?.id)
  const prior = detail.data?.history?.trades ?? []
  const review = detail.data?.footnoteReview
  const premium =
    t?.quotePrice && t.pricePerShare ? t.quotePrice / t.pricePerShare - 1 : null
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
              <Fact label="Market cap" value={fmtMoneyCompact(t.marketCap)} />
              <Fact
                label="Price when screened"
                value={
                  premium === null
                    ? fmtMoney(t.quotePrice, 2)
                    : `${fmtMoney(t.quotePrice, 2)} (${premium >= 0 ? "+" : ""}${(premium * 100).toFixed(1)}%)`
                }
              />
              <Fact
                label="Alpaca order"
                value={
                  t.alpacaFilledQty
                    ? `Bought ${fmtShares(t.alpacaFilledQty)} @ ${fmtMoney(t.alpacaFilledAvgPrice, 2)}`
                    : t.alpacaOrderId
                      ? `${t.alpacaOrderLimitPrice ? `Limit ${fmtMoney(t.alpacaOrderLimitPrice, 2)}` : "Market"} · ${t.alpacaOrderStatus}`
                      : (t.alpacaOrderError ?? "—")
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
                  Opportunistic
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t.classifier}
                </span>
              </div>
              {t.patternSummary && (
                <p className="text-sm font-medium">{t.patternSummary}</p>
              )}
              {t.reasoning && (
                <p className="text-sm text-muted-foreground">{t.reasoning}</p>
              )}
            </div>

            {review && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-transparent bg-primary/15 text-primary dark:bg-primary/25 dark:text-primary-foreground"
                    >
                      Open-market purchase
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      footnotes · {review.model}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {review.reason}
                  </p>
                  {review.flags.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Keyword flags:{" "}
                      {review.flags
                        .map((f) => `“${f.match}” (${f.source})`)
                        .join(", ")}
                    </p>
                  )}
                </div>
              </>
            )}

            <Separator />

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">
                Purchases on this filing
              </h4>
              {detail.status !== "ready" ? (
                <p className="text-sm text-muted-foreground">
                  {detail.status === "loading"
                    ? "Loading…"
                    : "Couldn’t load the filing details."}
                </p>
              ) : (
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
                      {detail.data.transactions.map((x, i) => (
                        <TableRow key={i}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {fmtDate(x.date)}
                          </TableCell>
                          <TableCell>
                            <div>{x.securityTitle}</div>
                            {x.footnotes.length > 0 && (
                              <div className="max-w-md text-xs whitespace-normal text-muted-foreground">
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
              )}
            </div>

            {prior.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold">
                  Insider&apos;s earlier open-market trades
                </h4>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Issuer</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prior.map((x, i) => (
                        <TableRow key={`${x.accession}-${i}`}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {fmtDate(x.date)}
                          </TableCell>
                          <TableCell>{x.ticker ?? x.issuer}</TableCell>
                          <TableCell>
                            {x.code === "P" ? "Buy" : "Sale"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtInt(x.shares)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtMoney(x.price, 2)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {x.aff10b5One ? "10b5-1" : ""}
                          </TableCell>
                        </TableRow>
                      ))}
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
