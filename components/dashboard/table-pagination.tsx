"use client"

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fmtInt } from "@/lib/format"

const PAGE_SIZES = [10, 20, 50] as const

export type Pagination<T> = {
  rows: T[]
  page: number
  pageCount: number
  pageSize: number
  total: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
}

export function usePagination<T>(items: T[]): Pagination<T> {
  const [pageSize, setPageSizeState] = React.useState<number>(PAGE_SIZES[0])
  const [requested, setPage] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  // Clamp during render so a refresh that shrinks the list never strands the
  // user on an empty page.
  const page = Math.min(requested, pageCount - 1)
  const start = page * pageSize
  return {
    rows: items.slice(start, start + pageSize),
    page,
    pageCount,
    pageSize,
    total: items.length,
    setPage,
    setPageSize: (size) => {
      setPageSizeState(size)
      setPage(0)
    },
  }
}

export function TablePagination<T>({
  pagination: p,
}: {
  pagination: Pagination<T>
}) {
  const from = p.total === 0 ? 0 : p.page * p.pageSize + 1
  const to = Math.min(p.total, (p.page + 1) * p.pageSize)
  const first = p.page === 0
  const last = p.page >= p.pageCount - 1

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <p className="tabular-nums">
        {fmtInt(from)}–{fmtInt(to)} of {fmtInt(p.total)}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            value={String(p.pageSize)}
            onValueChange={(v) => p.setPageSize(Number(v))}
          >
            <SelectTrigger size="sm" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-0">
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {fmtInt(p.page + 1)} of {fmtInt(p.pageCount)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="First page"
              disabled={first}
              onClick={() => p.setPage(0)}
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={first}
              onClick={() => p.setPage(p.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={last}
              onClick={() => p.setPage(p.page + 1)}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Last page"
              disabled={last}
              onClick={() => p.setPage(p.pageCount - 1)}
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
