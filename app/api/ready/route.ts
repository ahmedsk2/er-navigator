import { prisma } from '@/src/lib/db'
import { buildFingerprint } from '@/src/lib/fingerprint'

// Readiness: runs SELECT 1 through the app role. 503 when the database is unreachable. The
// body on failure is deliberately not a superstring of the success body ("ready"), so a
// keyword monitor cannot be fooled by it; the status code fails such a monitor anyway.
export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'cache-control': 'no-store', 'x-build-fingerprint': buildFingerprint() }
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ status: 'ready' }, { headers })
  } catch {
    return Response.json({ status: 'database unreachable' }, { status: 503, headers })
  }
}
