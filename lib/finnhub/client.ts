import { assertTimeLeft, backoffMs, requestTimeout } from "@/lib/deadline"
import { env } from "@/lib/env"
import { sleep, throttle } from "@/lib/throttle"

const FINNHUB_API = "https://finnhub.io/api/v1"
const MAX_RETRIES = 3

/** Finnhub's free tier allows 60 requests/minute, so requests are spaced one second apart. */
const acquireSlot = throttle("finnhub", 1_000)

async function finnhubJson<T>(path: string): Promise<T> {
  if (!env.finnhubApiKey) throw new Error("FINNHUB_API_KEY is not set")
  for (let attempt = 0; ; attempt++) {
    assertTimeLeft()
    await acquireSlot()
    const res = await fetch(`${FINNHUB_API}${path}`, {
      headers: {
        "X-Finnhub-Token": env.finnhubApiKey,
        accept: "application/json",
      },
      signal: requestTimeout(20_000),
    })
    if (res.ok) return (await res.json()) as T
    // 429 means the per-minute budget is spent; wait for the window to roll over.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(5_000 * 2 ** attempt))
      continue
    }
    throw new Error(
      `Finnhub ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`
    )
  }
}

interface Profile2 {
  ticker?: string
  /** Millions of `currency`. */
  marketCapitalization?: number
}

/** Market capitalization in dollars, or null when Finnhub has no profile for the symbol. */
export async function getMarketCap(symbol: string): Promise<number | null> {
  const p = await finnhubJson<Profile2>(
    `/stock/profile2?symbol=${encodeURIComponent(symbol)}`
  )
  const cap = p.marketCapitalization
  return p.ticker && typeof cap === "number" && cap > 0 ? cap * 1_000_000 : null
}
