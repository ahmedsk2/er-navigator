/**
 * The two export route handlers, minus the request plumbing.
 *
 * `assertCan` is the whole permission check and it is the same one a server action uses: a
 * NAVIGATOR asking for the workbook gets an `auth.forbidden` audit row and a 403, exactly as the
 * locked plan's matrix says (`export.xlsx` is SUPERVISOR, ADMIN, VIEWER). Splitting it out this
 * way is what lets tests/db/export.test.ts drive the real handler against a real database instead
 * of asserting the policy table a second time.
 *
 * An export is a read, so there is no audit row for a successful one — the audit table is for
 * changes. It is logged at info level with the actor and the range instead, which is what the
 * spec asks for and what an operator needs when someone asks who pulled a month of cases.
 */
import { type AuditContext } from '@/src/lib/audit'
import { assertCan, isForbiddenError, type AuthUser } from '@/src/lib/auth/session'
import { dashboard } from '@/src/lib/domain/aggregates'
import { adaaWorkbook } from './adaa'
import { countCasesForExport, loadCasesForExport } from './load'
import { qchWorkbook } from './qch'
import { exportFilename, type ExportRange } from './range'
import { dataSheets, summaryRows, type CaseForExport } from './rows'
import { freePart, tablePart, xlsxResponseOf, type WorkbookPart } from './workbook'

const NO_STORE = { 'cache-control': 'no-store' } as const

const FORBIDDEN = (): Response =>
  new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json', ...NO_STORE },
  })

/**
 * True means "refused, and `assertCan` has already written the audit row". The row's `after`
 * carries the format as well as the role, so the record says which workbook was attempted.
 */
async function refused(user: AuthUser, range: ExportRange, ctx: AuditContext): Promise<boolean> {
  try {
    await assertCan(user, 'export.xlsx', ctx, { format: range.format })
    return false
  } catch (error) {
    if (isForbiddenError(error)) return true
    throw error
  }
}

export type ExportCountPayload = ExportRange & { count: number }

/** What the export page polls as the nurse moves the dates: how many cases would be written. */
export async function exportCountResponse(
  user: AuthUser,
  range: ExportRange,
  ctx: AuditContext,
): Promise<Response> {
  if (await refused(user, range, ctx)) return FORBIDDEN()
  const count = await countCasesForExport(range)
  const payload: ExportCountPayload = { ...range, count }
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json', ...NO_STORE },
  })
}

export async function exportWorkbookResponse(
  user: AuthUser,
  range: ExportRange,
  ctx: AuditContext,
  now: Date,
): Promise<Response> {
  if (await refused(user, range, ctx)) return FORBIDDEN()

  const cases = await loadCasesForExport(range)

  console.info(
    `[export] xlsx actor=${user.id} format=${range.format} from=${range.from} to=${range.to} status=${range.status} cases=${cases.length}`,
  )
  return xlsxResponseOf(workbookFor(cases, range, now), exportFilename(range))
}

/**
 * One range, one read, three layouts. The rows are the same in all three — the format changes
 * only which sheets are written from them, which is why the live count on `/export` is honest
 * whichever format is selected.
 */
function workbookFor(
  cases: ReadonlyArray<CaseForExport>,
  range: ExportRange,
  now: Date,
): WorkbookPart[] {
  if (range.format === 'adaa') return adaaWorkbook({ cases, range, generatedAt: now })
  if (range.format === 'qch') return qchWorkbook({ cases, range, generatedAt: now })
  // `dashboard()` does its own range filter; the rows are already the range, so 'all' is a no-op.
  const data = dashboard(cases, 'all', now)
  return [
    freePart({
      name: 'Summary',
      widths: [30, 26, 14],
      rows: summaryRows({ data, range, generatedAt: now }),
    }),
    ...dataSheets(cases, now).map(tablePart),
  ]
}
