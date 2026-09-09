/**
 * The shift handover sheet: what the board becomes on paper.
 *
 * It is rendered into every board page and hidden on screen (`.print-only` in app/globals.css);
 * `@media print` hides the search box, the filter chips, the tab bar, the FAB and the coloured
 * screen rows, and shows this instead. Same rows, same order, same clock — a plain table with
 * hairlines, 11 px, no colour to run out of a ward printer's toner.
 */
import { Fragment } from 'react'
import { elapsedOf, identityChips, idleHours, resolvedText, stalenessText } from '@/src/lib/board/rows'
import type { BoardRow } from '@/src/lib/board/types'
import { fmtClock, fmtSheetStamp, fmtStamp } from '@/src/lib/cases/local-time'
import { fmtHours } from '@/src/lib/domain/time'

const HEAD = 'border border-line px-1.5 py-1 text-left font-bold'
const CELL = 'border border-line px-1.5 py-1 align-top'

/** Open rows carry their staleness line; a resolved row's outcome is in its own column. */
function lastUpdateText(row: BoardRow, now: Date): string {
  const staleness = stalenessText(idleHours(row, now))
  if (staleness) return staleness
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
}: {
  rows: ReadonlyArray<BoardRow>
  now: Date
  printedBy: string
}) {
  return (
    <section className="print-only">
      <h2 className="text-[13px] font-bold">
        Qatif Central Hospital, Emergency Department. ER Navigator handover
      </h2>
      <p className="num mt-0.5 mb-2 text-[11px]">
        {fmtSheetStamp(now.toISOString())} (Asia/Riyadh) · {printedBy} · {rows.length}{' '}
        {rows.length === 1 ? 'case' : 'cases'}
      </p>

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
              </td>
              <td className={`num ${CELL}`}>{fmtStamp(row.registrationAt)}</td>
              <td className={`num ${CELL}`}>{fmtHours(elapsedOf(row, now))}</td>
              <td className={CELL}>{row.primaryReason ?? 'No reason set'}</td>
              <td className={CELL}>{row.departments.join(', ')}</td>
              <td className={`num ${CELL}`}>{lastUpdateText(row, now)}</td>
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
