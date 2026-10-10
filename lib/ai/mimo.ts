import { assertTimeLeft, backoffMs, requestTimeout } from "@/lib/deadline"
import { env } from "@/lib/env"
import { sleep } from "@/lib/throttle"

const MIMO_URL = "https://api.xiaomimimo.com/v1/chat/completions"
const MAX_RETRIES = 2
const REQUEST_TIMEOUT_MS = 90_000

export interface MimoJsonResult<T> {
  data: T
  model: string
  promptTokens: number | null
  completionTokens: number | null
}

interface ChatCompletion {
  model?: string
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export async function mimoJson<T>(opts: {
  system: string
  user: string
  schema: Record<string, unknown>
  schemaName: string
}): Promise<MimoJsonResult<T>> {
  if (!env.mimoApiKey) throw new Error("MIMO_API_KEY is not set")

  const body = JSON.stringify({
    model: env.mimoModel,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
  })

  for (let attempt = 0; ; attempt++) {
    assertTimeLeft()
    const res = await fetch(MIMO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.mimoApiKey,
      },
      body,
      signal: requestTimeout(REQUEST_TIMEOUT_MS),
    })
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(2_000 * 2 ** attempt))
      continue
    }
    if (!res.ok) {
      throw new Error(
        `MiMo request failed (${res.status}): ${(await res.text()).slice(0, 300)}`
      )
    }
    const json = (await res.json()) as ChatCompletion
    const content = json.choices?.[0]?.message?.content ?? ""
    let data: T
    try {
      data = JSON.parse(content) as T
    } catch {
      throw new Error(`Mimo returned invalid JSON: ${content.slice(0, 200)}`)
    }
    return {
      data,
      model: json.model ?? env.mimoModel,
      promptTokens: json.usage?.prompt_tokens ?? null,
      completionTokens: json.usage?.completion_tokens ?? null,
    }
  }
}
