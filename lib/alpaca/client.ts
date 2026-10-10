import { env } from "@/lib/env"

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
  limit_price: string | null
  filled_qty: string | null
  filled_avg_price: string | null
  filled_at: string | null
  created_at: string
  submitted_at: string | null
}

export interface AlpacaAsset {
  id: string
  class: string
  symbol: string
  name: string
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

const ALPACA_DATA_URL = "https://data.alpaca.markets"

export function alpacaConfigured(): boolean {
  return Boolean(env.alpacaKey && env.alpacaSecret)
}

const writesStubbed = !env.isProduction

export const STUB_ORDER_PREFIX = "stub-"

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  baseUrl = env.alpacaBaseUrl
): Promise<T> {
  if (!alpacaConfigured())
    throw new AlpacaError("ALPACA_KEY / ALPACA_SECRET are not set", 0)
  if (method !== "GET" && writesStubbed)
    throw new Error(`Alpaca ${method} ${path} blocked outside production`)
  const res = await fetch(`${baseUrl}${path}`, {
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

export interface LatestTrade {
  price: number
  at: string
}

export async function getLatestTrade(symbol: string): Promise<LatestTrade> {
  const res = await request<{ trade?: { p: number; t: string } | null }>(
    "GET",
    `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=${encodeURIComponent(env.alpacaDataFeed)}`,
    undefined,
    ALPACA_DATA_URL
  )
  if (!res.trade || !(res.trade.p > 0))
    throw new AlpacaError(`No ${env.alpacaDataFeed} trade for ${symbol}`, 404)
  return { price: res.trade.p, at: res.trade.t }
}

export interface MarketClock {
  is_open: boolean
  next_open: string
  next_close: string
}

export const getClock = () => request<MarketClock>("GET", "/v2/clock")

export const getOrder = (id: string) =>
  request<AlpacaOrder>("GET", `/v2/orders/${encodeURIComponent(id)}`)

export const cancelOrder = async (id: string): Promise<null> =>
  writesStubbed
    ? null
    : request<null>("DELETE", `/v2/orders/${encodeURIComponent(id)}`)

export async function findOrderByClientId(
  clientOrderId: string
): Promise<AlpacaOrder | null> {
  try {
    return await getOrderByClientId(clientOrderId)
  } catch (err) {
    if (err instanceof AlpacaError && err.status === 404) return null
    throw err
  }
}

export interface BuyRequest {
  asset: AlpacaAsset
  notional: number
  price: number
  clientOrderId: string
}

export async function placeMarketBuy(req: BuyRequest): Promise<AlpacaOrder> {
  const { asset } = req
  if (!asset.tradable || asset.status !== "active")
    throw new AlpacaError(`${asset.symbol} is not tradable on Alpaca`, 422)
  const base = {
    symbol: asset.symbol,
    side: "buy" as const,
    type: "market" as const,
    time_in_force: "day" as const,
    client_order_id: req.clientOrderId.slice(0, 128),
  }
  let order: OrderBody
  if (asset.fractionable) {
    order = { ...base, notional: req.notional.toFixed(2) }
  } else {
    const qty = Math.floor(req.notional / req.price)
    if (qty < 1)
      throw new AlpacaError(
        `${asset.symbol} is not fractionable and $${req.notional} buys less than one share at $${req.price}`,
        422
      )
    order = { ...base, qty: String(qty) }
  }
  return writesStubbed
    ? stubFill(order, req.price)
    : request<AlpacaOrder>("POST", "/v2/orders", order)
}

type OrderBody = Pick<
  AlpacaOrder,
  "symbol" | "side" | "type" | "time_in_force" | "client_order_id"
> & { notional?: string; qty?: string }

function stubFill(order: OrderBody, price: number): AlpacaOrder {
  const now = new Date().toISOString()
  const qty = order.qty ? Number(order.qty) : Number(order.notional) / price
  console.log(
    `[synra] alpaca: stubbed buy of ${order.symbol} (not production, no order sent)`
  )
  return {
    ...order,
    id: `${STUB_ORDER_PREFIX}${crypto.randomUUID()}`,
    status: "filled",
    notional: order.notional ?? null,
    qty: order.qty ?? null,
    limit_price: null,
    filled_qty: qty.toFixed(9).replace(/\.?0+$/, ""),
    filled_avg_price: String(price),
    filled_at: now,
    created_at: now,
    submitted_at: now,
  }
}
