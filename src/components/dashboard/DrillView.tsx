/**
 * A dashboard drill-down — the prototype's `if (drill) { … }` branch: a "‹ Dashboard" link, the
 * row's own label, the count, and the case list sorted longest stay first.
 *
 * The list is the board's own row component, so a case reads identically wherever it is seen and
 * a tap goes to the same editor. The ids come from `dashboard()`; this only fetches what a row
 * draws for them.
 */
import Link from 'next/link'
import { BoardRowItem } from '@/src/components/board/BoardRowItem'
import { sortByElapsed } from '@/src/lib/board/rows'
import type { BoardRow } from '@/src/lib/board/types'
import { dashboardHref } from '@/src/lib/dashboard/drill'
import type { Range } from '@/src/lib/domain/aggregates'

export function DrillView({
  label,
  rows,
  range,
  now,
}: {
  label: string
  rows: BoardRow[]
  range: Range
  now: Date
}) {
  const sorted = sortByElapsed(rows, now)

  return (
    <div className="dash">
      <div className="no-print px-4 pt-3.5 pb-1.5 lg:px-0 lg:pt-5">
        <Link
          href={dashboardHref(range)}
          className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-3 text-body font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ‹ Dashboard
        </Link>
      </div>

      <div className="px-4 pt-1 pb-2.5 lg:px-0">
        <h2 className="text-title" data-drill-label>
          {label}
        </h2>
        <p className="num mt-0.5 text-label text-muted" data-drill-count>
          {sorted.length} cases
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="border-y border-line bg-panel p-7 text-center text-body text-muted">
          These cases are no longer in this range.
        </p>
      ) : (
        <ul>
          {sorted.map((row) => (
            <BoardRowItem key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
    </div>
  )
}
