export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { env } = await import("@/lib/env")
  if (!env.schedulerEnabled) {
    console.log("[synra] scheduler disabled via SYNRA_SCHEDULER=0")
    return
  }
  const { startScheduler } = await import("@/lib/pipeline/scheduler")
  await startScheduler()
}
