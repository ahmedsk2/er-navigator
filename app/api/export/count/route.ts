import { auditContext, requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { parseExportRange } from '@/src/lib/export/range'
import { exportCountResponse } from '@/src/lib/export/service'

/**
 * `GET /api/export/count?from&to&status&format` — "{n} cases in range", live as the nurse moves
 * the dates. A count, not a page of rows: the export page must not download the workbook to say
 * how big it is. Same permission as the workbook itself, so the number cannot be read by a role
 * that may not read the file.
 *
 * The format does not change the count — all three workbooks are written from the same rows —
 * but it is parsed and echoed so the page can key its cache on the whole request and so a refusal
 * records which workbook was being sized up.
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

  // The whole parameter bag, not four `get`s: the Phase 10 case filter repeats its keys, and
  // `get` would keep only the first stage a nurse selected.
  const range = parseExportRange(new URL(request.url).searchParams, new Date())
  return exportCountResponse(user, range, await auditContext(user.id))
}
