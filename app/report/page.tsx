import type { Metadata } from 'next'
import { ReportView } from '@/src/components/report/ReportView'
import { requireAction } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import { dashboard } from '@/src/lib/domain/aggregates'
import { describeFilter, filterOptionsOf } from '@/src/lib/domain/case-filter'
import { loadCasesForStatsInRange } from '@/src/lib/export/load'
import { parseExportRange } from '@/src/lib/export/range'
import { reportHeader } from '@/src/lib/export/report-header'

export const metadata: Metadata = { title: 'Report · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/report?from&to&status` — SUPERVISOR, ADMIN, VIEWER (`report.print`). Opened in a new tab from
 * the export page and printed from there; a NAVIGATOR gets an `auth.forbidden` audit row and an
 * HTTP 403 carrying `app/forbidden.tsx`, both from `requireAction` (Phase 7).
 *
 * Outside the `(app)` route group on purpose: a report page with a tab bar and a floating "+ New
 * case" button on it is not a report. A bad or missing query string falls back to the default
 * range rather than erroring, so a hand-typed URL still prints something.
 *
 * The Phase 10 case filter rides on the same query string and is applied by the loader, so the
 * whole report is over the filtered population — and the masthead says so in words, because a
 * printed page cannot be asked what it was narrowed by.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAction('report.print')

  const now = new Date()
  const range = parseExportRange(await searchParams, now)
  const [cases, reference] = await Promise.all([loadCasesForStatsInRange(range), loadReference()])
  // The rows are already the range, so `dashboard()`'s own window must not narrow them again.
  const data = dashboard(cases, 'all', now)

  return (
    <ReportView
      data={data}
      range={range}
      header={reportHeader()}
      generatedAt={now}
      requestedBy={user.displayName}
      filterLine={range.filter ? describeFilter(range.filter, filterOptionsOf(reference)) : undefined}
    />
  )
}
