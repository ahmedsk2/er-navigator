import { auditContext, requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { parseExportRange } from '@/src/lib/export/range'
import { exportCountResponse } from '@/src/lib/export/service'

/**
 * `GET /api/export/count?from&to&status` — "{n} cases in range", live as the nurse moves the
 * dates. A count, not a page of rows: the export page must not download the workbook to say how
 * big it is. Same permission as the workbook itself, so the number cannot be read by a role that
 * may not read the file.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  let user
  try {
    user = await requireUser({ as: 'api' })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } })
    }
    throw error
  }

  const params = new URL(request.url).searchParams
  const range = parseExportRange(
    { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, status: params.get('status') ?? undefined },
    new Date(),
  )
  return exportCountResponse(user, range, await auditContext(user.id))
}
