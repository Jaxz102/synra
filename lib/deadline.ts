import { AsyncLocalStorage } from "node:async_hooks"

/** Thrown by SEC and Finnhub requests once the current poll run's time budget is spent. */
export class DeadlineExceeded extends Error {
  constructor() {
    super("Run time budget exhausted")
  }
}

const deadlines = new AsyncLocalStorage<number>()

/** Runs `fn` with a deadline (epoch ms) that the rate-limited API clients respect; no deadline runs it unbounded. */
export function withDeadline<T>(
  deadline: number | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return deadline === undefined ? fn() : deadlines.run(deadline, fn)
}

/** Milliseconds left before the current deadline; Infinity outside `withDeadline`. */
export function remainingMs(): number {
  const d = deadlines.getStore()
  return d === undefined ? Number.POSITIVE_INFINITY : d - Date.now()
}

export function assertTimeLeft(): void {
  if (remainingMs() <= 0) throw new DeadlineExceeded()
}

/** `AbortSignal.timeout(ms)`, cut short at the current deadline. */
export function requestTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(ms, remainingMs())))
}

/** A retry backoff that never sleeps past the current deadline. */
export function backoffMs(ms: number): number {
  return Math.max(0, Math.min(ms, remainingMs()))
}
