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
  initialLookbackHours: num(process.env.INITIAL_LOOKBACK_HOURS, 12),
  maxFeedPages: num(process.env.MAX_FEED_PAGES, 20),
  /** Shared secret a caller must send as `Authorization: Bearer …` to /api/cron/poll. */
  cronSecret: process.env.CRON_SECRET?.trim() ?? "",
  /** Postgres connection string. Required: all state lives there. See `databaseUrl()`. */
  databaseUrl: databaseUrl(),
  /** Alpaca paper-trading credentials. Required: listings, quotes and orders all come from Alpaca. */
  alpacaKey: process.env.ALPACA_KEY?.trim() ?? "",
  alpacaSecret: process.env.ALPACA_SECRET?.trim() ?? "",
  alpacaBaseUrl: (
    process.env.ALPACA_BASE_URL?.trim() || "https://paper-api.alpaca.markets"
  ).replace(/\/+$/, ""),
  /** Market data feed for current prices: "iex" (free plan, real-time) or "sip" (paid plan). */
  alpacaDataFeed: process.env.ALPACA_DATA_FEED?.trim() || "iex",
  /** Dollar amount bought on Alpaca for every posted trade. */
  alpacaOrderNotional: num(process.env.ALPACA_ORDER_NOTIONAL, 150),
  /** Finnhub key for market capitalization (free tier: 60 requests/minute). Required. */
  finnhubApiKey: process.env.FINNHUB_API_KEY?.trim() ?? "",
}
