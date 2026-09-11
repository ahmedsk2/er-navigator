/**
 * The two export route handlers, minus the request plumbing.
 *
 * `assertCan` is the whole permission check and it is the same one a server action uses: a
 * NAVIGATOR asking for the workbook gets an `auth.forbidden` audit row and a 403, exactly as the
 * locked plan's matrix says (`export.xlsx` is SUPERVISOR, ADMIN, VIEWER). Splitting it out this
 * way is what lets tests/db/export.test.ts drive the real handler against a real database instead
 * of asserting the policy table a second time.
 *
 * A successful export writes an `export.xlsx` audit row (Phase 12 item 7, readiness audit C2).
 * Until then the decision here read "an export is a read, so there is no audit row", and the only
 * trace was the `console.info` below, which lives in container logs that rotate. That reasoning
 * held for a table of changes; it does not hold for a page of MRNs leaving the building, which is
 * exactly what an information-governance question asks about. The console line stays — it is what
 * an operator greps — and the row is added beside it, on the success path only: a refusal is
 * already `auth.forbidden`, and the polled count is not the data.
 */
import { audit, type AuditContext } from '@/src/lib/audit'
import { assertCan, isForbiddenError, type AuthUser } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import { dashboard } from '@/src/lib/domain/aggregates'
import { caseFilterQuery, describeFilter, filterOptionsOf, isEmptyFilter } from '@/src/lib/domain/case-filter'
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

  // A filtered workbook names its filter in words under the status filter (Phase 10), and a stage
  // or an area is a code in the address but a name on paper — so the reference lists are read for
  // a filtered export only. An unfiltered one issues exactly the one read it always has.
  const filter = range.filter && !isEmptyFilter(range.filter) ? range.filter : undefined
  const [cases, reference] = await Promise.all([loadCasesForExport(range), filter ? loadReference() : null])
  const filterLine = filter && reference ? describeFilter(filter, filterOptionsOf(reference)) : undefined

  // The filter is part of the request, so it is part of the record: "who pulled a month of cases"
  // is a different question from "who pulled the insured ones". Both serialisations are kept —
  // the query string the URL carried, and the words the workbook prints — because a year from now
  // only one of them will still be readable without the code.
  const filterQuery = filter ? caseFilterQuery(filter) || null : null
  console.info(
    `[export] xlsx actor=${user.id} format=${range.format} from=${range.from} to=${range.to} status=${range.status} filter=${filterQuery ?? 'none'} cases=${cases.length}`,
  )
  // On the plain client, not in a transaction: there is no mutation here to bind it to.
  await audit(
    {
      action: 'export.xlsx',
      entity: 'Export',
      entityId: null,
      after: {
        format: range.format,
        from: range.from,
        to: range.to,
        status: range.status,
        filter: filterQuery,
        filterDescription: filterLine ?? null,
        cases: cases.length,
      },
    },
    ctx,
  )
  return xlsxResponseOf(workbookFor(cases, range, now, filterLine), exportFilename(range))
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
  filterLine: string | undefined,
): WorkbookPart[] {
  if (range.format === 'adaa') return adaaWorkbook({ cases, range, generatedAt: now, filterLine })
  if (range.format === 'qch') return qchWorkbook({ cases, range, generatedAt: now, filterLine })
  // `dashboard()` does its own range filter; the rows are already the range, so 'all' is a no-op.
  const data = dashboard(cases, 'all', now)
  return [
    freePart({
      name: 'Summary',
      widths: [30, 26, 14],
      rows: summaryRows({ data, range, generatedAt: now, filterLine }),
    }),
    ...dataSheets(cases, now).map(tablePart),
  ]
}
