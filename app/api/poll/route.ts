import { triggerNow } from "@/lib/pipeline/scheduler"
import { getPollStatus } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await getPollStatus())
}

export async function POST() {
  const result = triggerNow("manual")
  return Response.json(
    { ...result, status: await getPollStatus() },
    { status: result.started ? 202 : 409 }
  )
}
