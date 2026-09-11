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
 * Phase 12 put the mark at the head of the masthead, beside the hospital line: a report read in a
 * monthly meeting or left on a desk now says which app it came from without anyone reading it.
 *
 * Phase 8 added the deck's own opening block — the headline tiles, the stay bands, the Adaa KPI
 * panel and the working targets — which is the same four components the screen renders, in a
 * different order. `DashboardBody`'s `variant` is the whole of that difference.
 */
import { Mark } from '@/src/components/brand/Mark'
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
  filterLine,
}: {
  data: DashboardData
  range: ExportRange
  header: string
  generatedAt: Date
  requestedBy: string
  /**
   * The Phase 10 case filter in words, or nothing. A printed report over part of the department
   * that does not say which part is a number somebody will quote in a meeting.
   */
  filterLine?: string
}) {
  return (
    // The sections inside DashboardBody drop their phone inset at `lg`, because in the signed-in
    // shell the content column supplies one. /report has no shell, so it gives the same inset
    // itself and the masthead gives its own back: the two edges stay on one line at both widths.
    <div className="dash mx-auto max-w-[900px] lg:px-4">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3 lg:px-0">
        {/* The mark and the heading block are one flex item, so the Print button stays at the
            right of the masthead and the whole block wraps under it as one on a phone. */}
        <div className="flex min-w-0 items-start gap-3">
          {/* Phase 12: the mark on paper, `onWhite` — a teal tile with a white cross, the tone
              that reads on a white sheet. Its tile is an SVG `rect` fill rather than a CSS
              background, so it prints even in a browser that drops background graphics.

              Beside the heading, never inside it: tests/e2e/export.spec.ts asserts the `<h1>`
              holds exactly the header line. One size rather than a `lg:` bump, because the
              mark's stroke is tuned to the `size` it is given (`markGrow`) and a CSS-only
              resize would draw the larger box with the smaller box's stroke. */}
          <span data-report-mark className="mt-0.5 inline-flex shrink-0">
            <Mark size={44} tone="onWhite" />
          </span>
          <div className="min-w-0">
            <h1 className="text-title" data-report-header>
              {header}
            </h1>
            <p className="num mt-1 text-body text-ink-2" data-report-range>
              Report · {range.from} to {range.to} · {EXPORT_STATUS_LABELS[range.status]} · {data.inRange}{' '}
              {data.inRange === 1 ? 'case' : 'cases'}
            </p>
            {filterLine ? (
              <p className="mt-0.5 text-body text-ink-2" data-report-filter>
                Filtered: {filterLine}
              </p>
            ) : null}
            <p className="mt-0.5 text-caption text-muted" data-report-meta>
              Generated <span className="num">{fmtSheetStamp(generatedAt.toISOString())}</span> (Asia/Riyadh) for{' '}
              {requestedBy}
            </p>
          </div>
        </div>
        <PrintButton />
      </header>

      {/* `variant="report"` changes the order and nothing else: the headline, the stay bands, the
          Adaa panel and the working targets come first on paper, because that is the block a
          reader of the monthly deck looks for, and every other section follows in the order the
          screen shows it (Phase 8 spec, Slice E).

          The filter goes in too (Phase 10), so a row tapped on a filtered report opens the cases
          it was counted over rather than the whole department. `range.filter` is absent when there
          is none, which leaves every link on an unfiltered report the string it always was. */}
      <DashboardBody data={data} range="all" variant="report" filter={range.filter} />
    </div>
  )
}
