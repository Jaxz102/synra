import { Badge } from "@/components/ui/badge"
import type { FilingStatus } from "@/lib/db"
import { cn } from "@/lib/utils"

const META: Record<FilingStatus, { label: string; className: string }> = {
  posted: {
    label: "Posted",
    className:
      "bg-primary/15 text-primary dark:bg-primary/25 dark:text-primary-foreground",
  },
  skipped_sell: {
    label: "Sale",
    className: "border-border text-muted-foreground",
  },
  skipped_not_purchase: {
    label: "Not a purchase",
    className: "border-border text-muted-foreground",
  },
  skipped_10b5_1: {
    label: "10b5-1 plan",
    className: "border-border text-muted-foreground",
  },
  skipped_penny: {
    label: "$1 or under",
    className: "border-border text-muted-foreground",
  },
  skipped_routine: {
    label: "Routine",
    className: "bg-secondary text-secondary-foreground",
  },
  skipped_history: {
    label: "Too little history",
    className: "bg-secondary text-secondary-foreground",
  },
  skipped_price: {
    label: "Price ran",
    className: "bg-secondary text-secondary-foreground",
  },
  skipped_market_cap: {
    label: "Under $100M",
    className: "bg-secondary text-secondary-foreground",
  },
  skipped_listing: {
    label: "Not NYSE/Nasdaq",
    className: "border-border text-muted-foreground",
  },
  skipped_footnotes: {
    label: "Not open market",
    className: "bg-secondary text-secondary-foreground",
  },
  skipped_order: {
    label: "Not filled",
    className: "bg-secondary text-secondary-foreground",
  },
  error: {
    label: "Error",
    className: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  },
  queued: {
    label: "Queued",
    className: "border-dashed border-border text-muted-foreground",
  },
  processing: {
    label: "Processing",
    className:
      "border-dashed border-border text-muted-foreground animate-pulse",
  },
}

export function StatusBadge({ status }: { status: FilingStatus }) {
  const m = META[status] ?? { label: status, className: "" }
  return (
    <Badge variant="outline" className={cn("border-transparent", m.className)}>
      {m.label}
    </Badge>
  )
}
