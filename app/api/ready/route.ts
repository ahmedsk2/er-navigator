import { prisma } from '@/src/lib/db'

// Readiness: runs SELECT 1 through the app role. 503 when the database is unreachable.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return Response.json({ status: 'ready' }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ status: 'not-ready' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
