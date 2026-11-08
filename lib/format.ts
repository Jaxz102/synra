export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

export function fmtMoney(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

const moneyLarge = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
})

/** Full currency below $1B; $1.42B / $2.43T at and above it. */
export function fmtMoneyLarge(
  n: number | null | undefined,
  digits = 0
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  if (Math.abs(n) >= 1_000_000_000) return moneyLarge.format(n)
  return fmtMoney(n, digits)
}

/** Compact currency for tiles: $4.2M, $310K. */
export function fmtMoneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(0)}K`
  return fmtMoney(n)
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return fmtInt(n)
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `${Math.round(n * 100)}%`
}

const DISPLAY_TIME_ZONE = "America/New_York"

// Formatted separately and joined by hand: engines disagree on the combined
// pattern (Bun "Dec 1 at 9:30 AM", Chrome "Dec 1, 9:30 AM").
const dateTimeDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
})
const dateTimeTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
})

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"

  const dateOnly = iso.length === 10
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : DISPLAY_TIME_ZONE,
  })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${dateTimeDate.format(d)}, ${dateTimeTime.format(d)}`
}

export function fmtRelative(
  iso: string | null | undefined,
  now = Date.now()
): string {
  if (!iso) return "never"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = t - now
  const abs = Math.abs(diff)
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ]
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  for (const [ms, unit] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return diff <= 0 ? "just now" : "in under a minute"
}
