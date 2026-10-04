"use server"

import { getPollStatus, getTradeDetail, type TradeDetail } from "@/lib/queries"

/** The trade dialog's heavy JSON, kept out of the page payload. */
export async function loadTradeDetail(id: string): Promise<TradeDetail | null> {
  return getTradeDetail(id)
}

/** What the page polls to decide whether a refresh would show anything new. */
export async function checkDashboard(): Promise<{
  version: string
  running: boolean
}> {
  const status = await getPollStatus()
  return { version: status.version, running: !!status.running }
}
