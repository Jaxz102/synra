type Gate = { chain: Promise<void>; last: number }

declare global {
  var __synraGates: Map<string, Gate> | undefined
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function gate(key: string): Gate {
  const gates = (globalThis.__synraGates ??= new Map())
  let s = gates.get(key)
  if (!s) {
    s = { chain: Promise.resolve(), last: 0 }
    gates.set(key, s)
  }
  return s
}

/**
 * Returns an `acquire()` that serialises callers sharing `key` so consecutive slots start at least `minGapMs` apart.
 * The gate lives on globalThis so it survives Next dev reloads.
 */
export function throttle(key: string, minGapMs: number): () => Promise<void> {
  return async () => {
    const s = gate(key)
    const my = s.chain.then(async () => {
      const wait = s.last + minGapMs - Date.now()
      if (wait > 0) await sleep(wait)
      s.last = Date.now()
    })
    s.chain = my.catch(() => {})
    await my
  }
}
