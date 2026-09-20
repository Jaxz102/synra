import { ExternalLink } from "lucide-react"

import { StatusBadge } from "@/components/dashboard/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtDateTime } from "@/lib/format"
import type { Filing } from "@/lib/queries"

export function PipelineTable({ filings }: { filings: Filing[] }) {
  if (filings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
        No filings processed yet. Run a poll to start.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Feed time</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Insider</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filings.map((f) => (
            <TableRow key={f.accession}>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {fmtDateTime(f.feedUpdated)}
              </TableCell>
              <TableCell>
                <StatusBadge status={f.status} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{f.ticker ?? "—"}</span>
                  <span className="max-w-48 truncate text-xs text-muted-foreground">
                    {f.issuerName ?? ""}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>{f.insiderName ?? "—"}</span>
                  <span className="max-w-48 truncate text-xs text-muted-foreground">
                    {f.insiderRole ?? ""}
                  </span>
                </div>
              </TableCell>
              <TableCell
                className="max-w-md truncate text-muted-foreground"
                title={f.reason ?? undefined}
              >
                {f.reason ?? ""}
              </TableCell>
              <TableCell>
                {f.indexUrl && (
                  <a
                    href={f.indexUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open SEC filing"
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
  )
}
