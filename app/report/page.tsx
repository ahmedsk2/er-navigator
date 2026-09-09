import type { Metadata } from 'next'
import { ReportView } from '@/src/components/report/ReportView'
import { requireAction } from '@/src/lib/auth/session'
import { dashboard } from '@/src/lib/domain/aggregates'
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
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; status?: string | string[] }>
}) {
  const user = await requireAction('report.print')

  const now = new Date()
  const range = parseExportRange(await searchParams, now)
  const cases = await loadCasesForStatsInRange(range)
  // The rows are already the range, so `dashboard()`'s own window must not narrow them again.
  const data = dashboard(cases, 'all', now)

  return (
    <ReportView
      data={data}
      range={range}
      header={reportHeader()}
      generatedAt={now}
      requestedBy={user.displayName}
    />
  )
}
