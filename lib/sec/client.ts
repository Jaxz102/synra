import { env } from "@/lib/env"

/** SEC allows at most 10 requests/second; we space requests ~8/s and retry on throttling. */
const MIN_GAP_MS = 125
const MAX_RETRIES = 4
const REQUEST_TIMEOUT_MS = 90_000

type G = typeof globalThis & {
  __synraSecGate?: { chain: Promise<void>; last: number }
}

function gate() {
  const g = globalThis as G
  if (!g.__synraSecGate)
    g.__synraSecGate = { chain: Promise.resolve(), last: 0 }
  return g.__synraSecGate
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function acquireSlot(): Promise<void> {
  const s = gate()
  const my = s.chain.then(async () => {
    const wait = s.last + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    s.last = Date.now()
  })
  s.chain = my.catch(() => {})
  await my
}

export class SecHttpError extends Error {
  constructor(
    public status: number,
    public url: string
  ) {
    super(`SEC request failed (${status}): ${url}`)
  }
}

export async function secFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let attempt = 0
  for (;;) {
    await acquireSlot()
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": env.secUserAgent,
          Accept:
            "application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
          ...(init.headers ?? {}),
        },
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      // Network hiccups and timeouts are retried the same way as throttling responses.
      if (attempt >= MAX_RETRIES)
        throw new Error(
          `SEC request failed after ${attempt + 1} attempts: ${url} (${(err as Error).name}: ${(err as Error).message})`
        )
      attempt += 1
      await sleep(1000 * 2 ** attempt)
      continue
    }
    if (res.ok) return res
    const retryable =
      res.status === 429 || res.status === 403 || res.status >= 500
    if (!retryable || attempt >= MAX_RETRIES)
      throw new SecHttpError(res.status, url)
    attempt += 1
    await sleep(1000 * 2 ** attempt)
  }
}

export async function secText(url: string): Promise<string> {
  const res = await secFetch(url)
  return res.text()
}

export async function secJson<T>(url: string): Promise<T> {
  const res = await secFetch(url)
  return (await res.json()) as T
}

export const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data"

/** "0001193125-26-389607" -> "000119312526389607" */
export function accessionNoDash(accession: string): string {
  return accession.replace(/-/g, "")
}

export function cikNoPad(cik: string): string {
  return String(Number.parseInt(cik, 10))
}

export function cikPadded(cik: string): string {
  return cikNoPad(cik).padStart(10, "0")
}

export function filingBaseUrl(cik: string, accession: string): string {
  return `${SEC_ARCHIVES}/${cikNoPad(cik)}/${accessionNoDash(accession)}`
}

export function filingIndexHtmlUrl(cik: string, accession: string): string {
  return `${filingBaseUrl(cik, accession)}/${accession}-index.htm`
}
