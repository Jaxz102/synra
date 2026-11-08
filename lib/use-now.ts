"use client"

import { useSyncExternalStore } from "react"

const TICK_MS = 30_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  now = Date.now()
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!timer) {
    now = Date.now()
    timer = setInterval(tick, TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null
  )
}
