import { env } from "@/lib/env"

const XAI_URL = "https://api.x.ai/v1/chat/completions"

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

function extractJson(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) return JSON.parse(fenced[1])
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start >= 0 && end > start)
      return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error("Grok response did not contain JSON")
  }
}

/** Calls xAI chat completions and returns the JSON object the model produced. */
export async function grokJson<T>(opts: {
  system: string
  user: string
  schema: Record<string, unknown>
  schemaName: string
  temperature?: number
}): Promise<GrokJsonResult<T>> {
  if (!env.xaiApiKey) throw new Error("XAI_API_KEY is not set")
  const body = {
    model: env.xaiModel,
    temperature: opts.temperature ?? 0.1,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
  }
  let res = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.xaiApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (res.status === 400) {
    // Some models reject json_schema; fall back to json_object mode with the schema in the prompt.
    const errText = await res.text()
    const fallback = {
      ...body,
      messages: [
        {
          role: "system",
          content: `${opts.system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(opts.schema)}`,
        },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
    }
    res = await fetch(XAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.xaiApiKey}`,
      },
      body: JSON.stringify(fallback),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok)
      throw new Error(
        `xAI request failed (${res.status}): ${errText.slice(0, 300)} / ${(await res.text()).slice(0, 300)}`
      )
  } else if (!res.ok) {
    throw new Error(
      `xAI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`
    )
  }
  const json = (await res.json()) as ChatCompletion
  const content = json.choices?.[0]?.message?.content ?? ""
  return {
    data: extractJson(content) as T,
    model: json.model ?? env.xaiModel,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
  }
}
