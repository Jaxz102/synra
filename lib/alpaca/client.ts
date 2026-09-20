import { env } from "@/lib/env"

/** Subset of Alpaca's order object that we keep (https://docs.alpaca.markets/reference/postorder). */
export interface AlpacaOrder {
  id: string
  client_order_id: string
  symbol: string
  status: string
  side: "buy" | "sell"
  type: string
  time_in_force: string
  notional: string | null
  qty: string | null
  filled_qty: string | null
  filled_avg_price: string | null
  created_at: string
  submitted_at: string | null
}

export interface AlpacaAsset {
  id: string
  symbol: string
  status: "active" | "inactive"
  tradable: boolean
  fractionable: boolean
  exchange: string
}

export class AlpacaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number
  ) {
    super(message)
    this.name = "AlpacaError"
  }
}

export function alpacaConfigured(): boolean {
  return Boolean(env.alpacaKey && env.alpacaSecret)
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  if (!alpacaConfigured())
    throw new AlpacaError("ALPACA_KEY / ALPACA_SECRET are not set", 0)
  const res = await fetch(`${env.alpacaBaseUrl}${path}`, {
    method,
    headers: {
      "APCA-API-KEY-ID": env.alpacaKey,
      "APCA-API-SECRET-KEY": env.alpacaSecret,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const err = data as { message?: string; code?: number } | string | null
    const message =
      (typeof err === "object" && err?.message) ||
      (typeof err === "string" && err) ||
      res.statusText
    throw new AlpacaError(
      `Alpaca ${method} ${path} → ${res.status}: ${message}`,
      res.status,
      typeof err === "object" ? err?.code : undefined
    )
  }
  return data as T
}

export const getAsset = (symbol: string) =>
  request<AlpacaAsset>("GET", `/v2/assets/${encodeURIComponent(symbol)}`)

export const getOrderByClientId = (clientOrderId: string) =>
  request<AlpacaOrder>(
    "GET",
    `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`
  )

export interface BuyRequest {
  symbol: string
  /** Dollar amount to buy. */
  notional: number
  /** Idempotency key; Alpaca rejects a second order with the same id. Max 128 chars. */
  clientOrderId: string
  /** Last known price, used to size a whole-share order when the asset is not fractionable. */
  referencePrice?: number | null
}

/**
 * Places a day market buy for `notional` dollars. Non-fractionable assets can't take notional orders,
 * so those fall back to `floor(notional / referencePrice)` whole shares (or throw when that is 0).
 */
export async function placeMarketBuy(req: BuyRequest): Promise<AlpacaOrder> {
  const symbol = req.symbol.trim().toUpperCase()
  const asset = await getAsset(symbol)
  if (!asset.tradable || asset.status !== "active")
    throw new AlpacaError(`${symbol} is not tradable on Alpaca`, 422)
  const base = {
    symbol,
    side: "buy" as const,
    type: "market" as const,
    time_in_force: "day" as const,
    client_order_id: req.clientOrderId.slice(0, 128),
  }
  if (asset.fractionable)
    return request<AlpacaOrder>("POST", "/v2/orders", {
      ...base,
      notional: req.notional.toFixed(2),
    })
  const qty =
    req.referencePrice && req.referencePrice > 0
      ? Math.floor(req.notional / req.referencePrice)
      : 0
  if (qty < 1)
    throw new AlpacaError(
      `${symbol} is not fractionable and $${req.notional} buys less than one share` +
        (req.referencePrice
          ? ` at $${req.referencePrice}`
          : " (no reference price)"),
      422
    )
  return request<AlpacaOrder>("POST", "/v2/orders", {
    ...base,
    qty: String(qty),
  })
}
