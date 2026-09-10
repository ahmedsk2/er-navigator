/**
 * `/report` — the dashboard on paper for one explicit date range.
 *
 * The body is `DashboardBody`, the very component `/dashboard` renders, so there is exactly one
 * implementation of the threshold table, the weekly panels, the bar sections, the consult and
 * investigation medians and the Other queue. What this adds is the masthead a printed report
 * needs and a screen does not: who the hospital is, which range was asked for, when it was
 * generated and who asked. Everything else is the Phase 4 print stylesheet (`.dash` in
 * app/globals.css), which already drops link styling and keeps every section together on a page.
 *
 * No tab bar, no floating button, no range chips: the route sits outside the signed-in shell for
 * the same reason the case editor does — one screen, one job.
 *
 * Phase 8 added the deck's own opening block — the headline tiles, the stay bands, the Adaa KPI
 * panel and the working targets — which is the same four components the screen renders, in a
 * different order. `DashboardBody`'s `variant` is the whole of that difference.
 */
import { PrintButton } from '@/src/components/report/PrintButton'
import { DashboardBody } from '@/src/components/dashboard/DashboardView'
import { fmtSheetStamp } from '@/src/lib/cases/local-time'
import { EXPORT_STATUS_LABELS, type ExportRange } from '@/src/lib/export/range'
import type { dashboard } from '@/src/lib/domain/aggregates'

type DashboardData = ReturnType<typeof dashboard>

export function ReportView({
  data,
  range,
  header,
  generatedAt,
  requestedBy,
}: {
  data: DashboardData
  range: ExportRange
  header: string
  generatedAt: Date
  requestedBy: string
}) {
  return (
    // The sections inside DashboardBody drop their phone inset at `lg`, because in the signed-in
    // shell the content column supplies one. /report has no shell, so it gives the same inset
    // itself and the masthead gives its own back: the two edges stay on one line at both widths.
    <div className="dash mx-auto max-w-[900px] lg:px-4">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3 lg:px-0">
        <div className="min-w-0">
          <h1 className="text-title" data-report-header>
            {header}
          </h1>
          <p className="num mt-1 text-body text-ink-2" data-report-range>
            Report · {range.from} to {range.to} · {EXPORT_STATUS_LABELS[range.status]} · {data.inRange}{' '}
            {data.inRange === 1 ? 'case' : 'cases'}
          </p>
          <p className="mt-0.5 text-caption text-muted" data-report-meta>
            Generated <span className="num">{fmtSheetStamp(generatedAt.toISOString())}</span> (Asia/Riyadh) for{' '}
            {requestedBy}
          </p>
        </div>
        <PrintButton />
      </header>

      {/* `variant="report"` changes the order and nothing else: the headline, the stay bands, the
          Adaa panel and the working targets come first on paper, because that is the block a
          reader of the monthly deck looks for, and every other section follows in the order the
          screen shows it (Phase 8 spec, Slice E). */}
      <DashboardBody data={data} range="all" variant="report" />
    </div>
  )
}
