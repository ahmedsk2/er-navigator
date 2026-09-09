import { buildFingerprint } from '@/src/lib/fingerprint'

// Liveness only: proves the process serves. It deliberately does not touch the database so
// an outage there cannot become a restart loop. /api/ready is the DB probe.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { status: 'ok' },
    { headers: { 'cache-control': 'no-store', 'x-build-fingerprint': buildFingerprint() } },
  )
}
