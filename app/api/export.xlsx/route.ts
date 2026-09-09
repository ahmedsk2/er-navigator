import { auditContext, requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { parseExportRange } from '@/src/lib/export/range'
import { exportWorkbookResponse } from '@/src/lib/export/service'

/**
 * `GET /api/export.xlsx?from&to&status&format` — the workbook, streamed.
 *
 * The path really does carry the extension: the browser hits it with a plain link, and Excel and
 * Windows both go by the name in the Content-Disposition, so an `.xlsx` in the URL is what makes
 * "save link as" behave. Everything below the session lookup lives in src/lib/export/service.ts,
 * which the database suite drives directly.
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

  const now = new Date()
  const params = new URL(request.url).searchParams
  const range = parseExportRange(
    {
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      status: params.get('status') ?? undefined,
      format: params.get('format') ?? undefined,
    },
    now,
  )
  return exportWorkbookResponse(user, range, await auditContext(user.id), now)
}
