/**
 * The shift handover sheet: what the board becomes on paper.
 *
 * It is rendered into every board page and hidden on screen (`.print-only` in app/globals.css);
 * `@media print` hides the search box, the filter chips, the tab bar, the FAB and the coloured
 * screen rows, and shows this instead. Same rows, same order, same clock — a plain table with
 * hairlines, 11 px, no colour to run out of a ward printer's toner.
 *
 * Phase 12 put the mark on the title line: a sheet pinned to a noticeboard now says which app it
 * came from. It is the one piece of colour on the page, and it is 20 px of it.
 */
import { Fragment } from 'react'
import { Mark } from '@/src/components/brand/Mark'
import {
  elapsedOf,
  identityChips,
  lastActivityAt,
  normalizeMrnQuery,
  resolvedText,
} from '@/src/lib/board/rows'
import type { BoardRow } from '@/src/lib/board/types'
import { fmtClock, fmtSheetStamp, fmtStamp } from '@/src/lib/cases/local-time'
import {
  describeFilter,
  isEmptyFilter,
  type CaseFilter,
  type FilterReference,
} from '@/src/lib/domain/case-filter'
import { fmtHours } from '@/src/lib/domain/time'

const HEAD = 'border border-line px-1.5 py-1 text-left font-bold'
const CELL = 'border border-line px-1.5 py-1 align-top'

/**
 * What narrowed the rows the sheet prints, as one line for under its stamp, or null when nothing
 * did (Phase 10 review). The sheet prints the rows the board is showing, and the two things on
 * screen that say those rows are only part of the board — the filter's chips and its count line —
 * are `.no-print`. Without this, a charge nurse who narrowed to Admission process and printed at
 * shift change handed over a partial list with nothing on the paper saying so.
 *
 * The case filter in `describeFilter`'s words, the sentence the dashboard and the report print.
 * The MRN search only when it narrows anything, which is when it holds a digit (`searchRows`
 * drops everything else before it matches, so a box of letters filters nothing out), and as those
 * digits rather than as typed: they are what the rows were matched on, and a name typed into the
 * box by mistake never reaches paper.
 */
export function narrowingLine(
  caseFilter: CaseFilter,
  reference: FilterReference,
  query: string,
): string | null {
  const parts: string[] = []
  if (!isEmptyFilter(caseFilter)) parts.push(`Filtered: ${describeFilter(caseFilter, reference)}`)
  const digits = normalizeMrnQuery(query)
  if (digits) parts.push(`MRN search: ${digits}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The Last update column: a clock time, dd/mm HH:mm in Asia/Riyadh, never a relative one (Phase
 * 11, finding 8). The sheet used to print the screen's "Updated 0h 12m ago" / "No update for
 * 3h 10m", which was true when it was printed and wrong by the time it was read at the handover.
 * An open case prints the moment its screen line counts from — its newest update, or when it was
 * opened if nobody has written one (`lastActivityAt`); a resolved case its last update, or a dash.
 */
export function lastUpdateText(row: BoardRow): string {
  if (row.status === 'OPEN') return fmtStamp(lastActivityAt(row).toISOString())
  return row.lastUpdateAt ? fmtStamp(row.lastUpdateAt) : '–'
}

/**
 * The case's time sequence in one line under its row (Phase 8): "08:12 Registration · +0h 14m
 * Triage · …", the same `timeline()` steps the case page lists, printed compactly because the
 * sheet's job is to be read at a shift handover, not to be a per-case slide.
 *
 * A case with nothing recorded but its registration prints no line at all: the registration time
 * is already in its own column, and an empty row is one more line for a ward printer for nothing.
 */
function TimelineRow({ row }: { row: BoardRow }) {
  if (row.timeline.length < 2) return null
  return (
    <tr className="break-inside-avoid" data-timeline-row={row.mrn}>
      <td className={`${CELL} text-[10px] leading-tight`} colSpan={7}>
        {row.timeline.map((step, i) => (
          <span key={step.key} className="whitespace-nowrap">
            {i > 0 ? <span className="text-muted"> · </span> : null}
            <span className="num">{fmtClock(step.at)}</span> {step.label}
            {step.fromPrevious == null ? null : <span className="num"> (+{fmtHours(step.fromPrevious)})</span>}
          </span>
        ))}
      </td>
    </tr>
  )
}

export function HandoverSheet({
  rows,
  now,
  printedBy,
  narrowing,
}: {
  rows: ReadonlyArray<BoardRow>
  now: Date
  printedBy: string
  /** `narrowingLine`'s sentence, or null for the whole board. */
  narrowing: string | null
}) {
  return (
    <section className="print-only">
      {/* Phase 12: the mark on the title line, `onWhite` — a teal tile with a white cross, the
          tone that reads on a ward printer's white paper, drawn as an SVG `rect` fill rather than
          a CSS background so it survives a browser that drops background graphics.

          Inside the `<h2>` rather than in a wrapper around it: the sheet's narrowing line is read
          as `h2 + p + [data-sheet-narrowed]` (tests/e2e/board.spec.ts), so the heading has to stay
          the stamp's own previous sibling. The mark is `aria-hidden`, so the heading's text and
          its accessible name are the line the sheet has always printed. */}
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold">
        <span data-handover-mark className="inline-flex shrink-0">
          <Mark size={20} tone="onWhite" />
        </span>
        Qatif Central Hospital, Emergency Department. ER Navigator handover
      </h2>
      {/* The stamp's bottom margin moves under the narrowing line when there is one, so a sheet of
          the whole board is exactly the sheet it always was. The line is bold because it is the
          one thing on the paper that says the list is not the whole board. */}
      <p className={narrowing ? 'num mt-0.5 text-[11px]' : 'num mt-0.5 mb-2 text-[11px]'}>
        {fmtSheetStamp(now.toISOString())} (Asia/Riyadh) · {printedBy} · {rows.length}{' '}
        {rows.length === 1 ? 'case' : 'cases'}
      </p>
      {narrowing ? (
        <p data-sheet-narrowed className="mb-2 text-[11px] font-bold">
          {narrowing}
        </p>
      ) : null}

      <table className="print-only w-full border-collapse text-[11px] leading-tight">
        <thead>
          <tr>
            <th className={HEAD}>MRN</th>
            <th className={HEAD}>Registered</th>
            <th className={HEAD}>Elapsed</th>
            <th className={HEAD}>Primary reason</th>
            <th className={HEAD}>Teams</th>
            <th className={HEAD}>Last update</th>
            <th className={HEAD}>Ward / disposition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
            <tr className="break-inside-avoid">
              {/* CTAS and the ED area ride with the MRN rather than costing two more columns on
                  a sheet that already has seven and has to fit a ward printer's page. */}
              <td className={`num ${CELL} font-bold`}>
                {row.mrn}
                {identityChips(row).map((chip) => (
                  <span key={chip} data-chip={chip} className="ml-1 font-normal">
                    {chip}
                  </span>
                ))}
                {/* Phase 10: the working diagnosis under the MRN rather than in a column of its
                    own. The sheet's seven headers are pinned and a ward printer's page is
                    already full; the MRN cell is where a reader looks for "who is this". */}
                {row.diagnosis ? (
                  <span data-diagnosis={row.diagnosis} className="block font-normal">
                    {row.diagnosis}
                  </span>
                ) : null}
              </td>
              <td className={`num ${CELL}`}>{fmtStamp(row.registrationAt)}</td>
              <td className={`num ${CELL}`}>{fmtHours(elapsedOf(row, now))}</td>
              <td className={CELL}>{row.primaryReason ?? 'No reason set'}</td>
              <td className={CELL}>{row.departments.join(', ')}</td>
              <td className={`num ${CELL}`}>{lastUpdateText(row)}</td>
              <td className={CELL}>{resolvedText(row)}</td>
            </tr>
            <TimelineRow row={row} />
            </Fragment>
          ))}
        </tbody>
      </table>

      {rows.length === 0 ? <p className="mt-2 text-[11px]">No cases on this board.</p> : null}
    </section>
  )
}
