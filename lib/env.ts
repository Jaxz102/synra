function num(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const isProduction = process.env.NODE_ENV === "production"

/**
 * Production (`NODE_ENV=production`, i.e. `next build && next start`) connects to
 * PRODUCTION_DATABASE_URL (Neon); everything else uses DATABASE_URL (local synradb).
 * Neither has a default in production so a misconfigured deploy fails fast instead of
 * silently talking to a local container.
 */
function databaseUrl(): string {
  if (isProduction) {
    const url = process.env.PRODUCTION_DATABASE_URL?.trim()
    if (!url) throw new Error("PRODUCTION_DATABASE_URL is not set")
    return url
  }
  return (
    process.env.DATABASE_URL?.trim() ||
    "postgres://synra:synra@localhost:5433/synradb?sslmode=disable"
  )
}

export const env = {
  isProduction,
  /** SEC requires a descriptive User-Agent ("AppName contact@email"). */
  secUserAgent:
    process.env.SEC_USER_AGENT?.trim() ||
    "Synra InsiderMonitor admin@example.com",
  xaiApiKey: process.env.XAI_API_KEY?.trim() ?? "",
  xaiModel: process.env.XAI_MODEL?.trim() || "grok-4.6",
  pollIntervalHours: num(process.env.POLL_INTERVAL_HOURS, 6),
  initialLookbackHours: num(process.env.INITIAL_LOOKBACK_HOURS, 12),
  maxFeedPages: num(process.env.MAX_FEED_PAGES, 20),
  historyMonths: num(process.env.HISTORY_MONTHS, 24),
  historyMaxFilings: num(process.env.HISTORY_MAX_FILINGS, 20),
  schedulerEnabled: process.env.SYNRA_SCHEDULER !== "0",
  /** Postgres connection string. Required: all state lives there. See `databaseUrl()`. */
  databaseUrl: databaseUrl(),
  /** Alpaca paper-trading credentials. Orders are skipped (and logged) when unset. */
  alpacaKey: process.env.ALPACA_KEY?.trim() ?? "",
  alpacaSecret: process.env.ALPACA_SECRET?.trim() ?? "",
  alpacaBaseUrl: (
    process.env.ALPACA_BASE_URL?.trim() || "https://paper-api.alpaca.markets"
  ).replace(/\/+$/, ""),
  /** Dollar amount bought on Alpaca for every posted trade. */
  alpacaOrderNotional: num(process.env.ALPACA_ORDER_NOTIONAL, 150),
}
