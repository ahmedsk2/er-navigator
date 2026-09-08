import { createHash } from 'node:crypto'

// Liveness only: proves the process serves. It deliberately does not touch the database so
// an outage there cannot become a restart loop. /api/ready is the DB probe.
// x-build-fingerprint = sha256(SOURCE_COMMIT)[0:16] so a deploy can be verified by commit, not
// by image tag (Coolify sets SOURCE_COMMIT at build time).
export const dynamic = 'force-dynamic'

export function GET() {
  const commit = process.env.SOURCE_COMMIT ?? 'unknown'
  const fingerprint = createHash('sha256').update(commit).digest('hex').slice(0, 16)
  return Response.json(
    { status: 'ok' },
    { headers: { 'cache-control': 'no-store', 'x-build-fingerprint': fingerprint } },
  )
}
