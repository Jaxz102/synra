import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtDateTime, fmtInt } from "@/lib/format"
import type { Run } from "@/lib/queries"

function duration(r: Run): string {
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now()
  const s = Math.max(0, Math.round((end - Date.parse(r.startedAt)) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function RunsTable({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
        No poll runs yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Feed entries</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead className="text-right">Posted</TableHead>
            <TableHead className="text-right">Routine</TableHead>
            <TableHead className="text-right">10b5-1</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">Other</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead>Cursor after</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="tabular-nums">{r.id}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {fmtDateTime(r.startedAt)}
              </TableCell>
              <TableCell className="capitalize">{r.trigger}</TableCell>
              <TableCell>
                {r.status === "success" ? (
                  <Badge variant="secondary">Success</Badge>
                ) : r.status === "running" ? (
                  <Badge variant="outline" className="animate-pulse">
                    Running
                  </Badge>
                ) : (
                  <Badge variant="destructive" title={r.error ?? undefined}>
                    Error
                  </Badge>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{duration(r)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.feedEntries)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.newFilings)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {fmtInt(r.posted)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.skippedRoutine)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.skipped10b51)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.skippedSell)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.skippedNotPurchase)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.errors)}
              </TableCell>
              <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                {r.cursorAfter ? fmtDateTime(r.cursorAfter) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
