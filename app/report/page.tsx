import type { Metadata } from 'next'
import Link from 'next/link'
import { ReportView } from '@/src/components/report/ReportView'
import { isForbiddenError, requireAction, type AuthUser } from '@/src/lib/auth/session'
import { dashboard } from '@/src/lib/domain/aggregates'
import { loadCasesForStatsInRange } from '@/src/lib/export/load'
import { parseExportRange } from '@/src/lib/export/range'
import { reportHeader } from '@/src/lib/export/report-header'

export const metadata: Metadata = { title: 'Report · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/report?from&to&status` — SUPERVISOR, ADMIN, VIEWER (`report.print`). Opened in a new tab from
 * the export page and printed from there; a NAVIGATOR gets the refusal screen and an
 * `auth.forbidden` audit row, written by `requireAction` before it throws.
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
  const user = await userWhoMayPrint()
  if (!user) return <Forbidden />

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

/** null means "refused, and the audit row is already written"; anything else is a real fault. */
async function userWhoMayPrint(): Promise<AuthUser | null> {
  try {
    return await requireAction('report.print')
  } catch (error) {
    if (isForbiddenError(error)) return null
    throw error
  }
}

function Forbidden() {
  return (
    <div className="mx-auto max-w-[720px] p-4">
      <h1 className="text-title">Not allowed</h1>
      <p className="mt-3 text-body text-ink-2">
        Your role can read the board and the dashboard, but not print the department report. Ask a
        charge nurse or an administrator for it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
      >
        ‹ Back
      </Link>
    </div>
  )
}
