import { assertTimeLeft, backoffMs, requestTimeout } from "@/lib/deadline"
import { env } from "@/lib/env"
import { sleep } from "@/lib/throttle"

const XAI_URL = "https://api.x.ai/v1/chat/completions"
const MAX_RETRIES = 2
/** Reasoning models can think for a while; the run deadline still cuts this short. */
const REQUEST_TIMEOUT_MS = 90_000

export interface GrokJsonResult<T> {
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

/** Calls xAI chat completions with a strict JSON schema and returns the parsed object. */
export async function grokJson<T>(opts: {
  system: string
  user: string
  schema: Record<string, unknown>
  schemaName: string
}): Promise<GrokJsonResult<T>> {
  if (!env.xaiApiKey) throw new Error("XAI_API_KEY is not set")
  const body = JSON.stringify({
    model: env.xaiModel,
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
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.xaiApiKey}`,
      },
      body,
      signal: requestTimeout(REQUEST_TIMEOUT_MS),
    })
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(2_000 * 2 ** attempt))
      continue
    }
    if (!res.ok)
      throw new Error(
        `xAI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`
      )
    const json = (await res.json()) as ChatCompletion
    const content = json.choices?.[0]?.message?.content ?? ""
    let data: T
    try {
      data = JSON.parse(content) as T
    } catch {
      throw new Error(`Grok returned invalid JSON: ${content.slice(0, 200)}`)
    }
    return {
      data,
      model: json.model ?? env.xaiModel,
      promptTokens: json.usage?.prompt_tokens ?? null,
      completionTokens: json.usage?.completion_tokens ?? null,
    }
  }
}
