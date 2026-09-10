/**
 * One board row, the prototype's information design line for line (`Board`, the `.row` block),
 * dressed as a card in Phase 9 (Ahmed's direction A of 10 September):
 *
 *   phone                                    laptop
 *   ┌──────────────────────────────┐         MRN   Registered  Waiting on   Last update  Elapsed
 *   │ MRN [chips] reg dd/mm HH:mm  │         ─────────────────────────────────────────────────
 *   │ primary reason · teams       │  6h05m  │ MRN  reg dd/mm  reason · teams   No update  6h05m│
 *   │ No update for 3h 10m         │         └───────────────────────────────────────────────┘
 *   └──────────────────────────────┘
 *
 * One `<a>`, one grid, two templates. Every cell is a direct child of the link, so the phone
 * stacks them with explicit placement and the laptop lets the five columns fill themselves; the
 * text, the order and every `data-*` hook are exactly what they were.
 *
 * The 6 px band stripe is gone. Its job — the threshold, read from across a corridor — is now the
 * elapsed clock itself, filled with the band's own colour (`BAND_PILL`, whose contrast with white
 * is recomputed from the token block by `src/components/__tests__/bands.test.ts`). One element
 * carrying the colour and the number beats two, and it survives the five-column row, where a
 * stripe on the far left would be 900 px from the time it describes.
 *
 * No `'use client'` of its own: the board renders it inside a client component, the dashboard
 * (Phase 4) reuses it from a server component, and it has no state either way.
 */
import Link from 'next/link'
import {
  bandOf,
  elapsedOf,
  identityChips,
  idleHours,
  isReviewed,
  isStale,
  reasonText,
  resolvedText,
  stalenessText,
} from '@/src/lib/board/rows'
import type { BoardRow } from '@/src/lib/board/types'
import { fmtStamp } from '@/src/lib/cases/local-time'
import { fmtHours, spokenHours } from '@/src/lib/domain/time'
import { BAND_PILL } from '@/src/components/bands'

// Band → class maps live in src/components/bands.ts since Phase 9 (one copy for the three readers).

/**
 * The five desktop columns, shared with the label strip `Board.tsx` draws above the list so the
 * two line up. Exported as a string because Tailwind needs the literal in the class attribute.
 */
export const ROW_COLUMNS = 'lg:grid-cols-[110px_120px_minmax(0,1fr)_180px_110px]'

/** What a cell does on the phone, undone at `lg` so the five columns can fill themselves. */
const CELL_RESET = 'lg:col-start-auto lg:row-start-auto lg:col-span-1 lg:row-span-1'

export function BoardRowItem({ row, now }: { row: BoardRow; now: Date }) {
  const hours = elapsedOf(row, now)
  const rowBand = bandOf(row, now)
  const idle = idleHours(row, now)
  const stale = isStale(idle)
  const chips = identityChips(row)

  return (
    <li>
      <Link
        href={`/cases/${row.id}`}
        data-mrn={row.mrn}
        data-band={rowBand}
        className={`mx-4 my-2 grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-card border border-line-soft bg-panel p-3.5 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset lg:mx-0 lg:my-2 lg:items-center lg:gap-x-3 lg:gap-y-0 lg:px-4 lg:py-3 ${ROW_COLUMNS}`}
      >
        <span className={`col-start-1 row-start-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${CELL_RESET}`}>
          <span className="num text-[16px] font-bold">{row.mrn}</span>
          {/* Phase 8: CTAS and the ED area, only when they were recorded, so a row that has
              neither reads exactly as it did before. */}
          {chips.map((chip) => (
            <span
              key={chip}
              data-chip={chip}
              className="num rounded-chip border border-line px-1.5 py-px text-caption text-ink-2"
            >
              {chip}
            </span>
          ))}
        </span>

        {/* "reg" stays in the text at both widths. The laptop's strip above the list already says
            "Registered", but the same row is reused by the dashboard drill-down, which has no
            strip, and four characters are cheaper than a row that reads differently in two
            places. */}
        <span className={`num col-start-2 row-start-1 self-baseline text-caption text-muted ${CELL_RESET}`}>
          reg {fmtStamp(row.registrationAt)}
        </span>

        <span className={`col-start-1 col-span-2 row-start-2 mt-[3px] block truncate text-label text-ink lg:mt-0 ${CELL_RESET}`}>
          {reasonText(row)}
        </span>

        {row.status === 'RESOLVED' ? (
          <span
            className={`col-start-1 col-span-2 row-start-3 flex flex-wrap items-baseline gap-x-1.5 text-caption text-band-ok ${CELL_RESET}`}
          >
            <span>{resolvedText(row)}</span>
            {/* Phase 8b: a supervisor has read this one. The chip and nothing else — who and
                when are on the case page, and the row has one line for the outcome. */}
            {isReviewed(row) ? (
              <span
                data-chip="Reviewed"
                className="rounded-chip border border-line px-1.5 py-px text-caption text-ink-2"
              >
                Reviewed
              </span>
            ) : null}
          </span>
        ) : (
          <span
            className={`num col-start-1 col-span-2 row-start-3 block text-caption ${stale ? 'font-semibold text-band-h4-ink' : 'text-muted'} ${CELL_RESET}`}
          >
            {stalenessText(idle)}
          </span>
        )}

        {/* The eye reads "6h 05m"; a screen reader would say "six h zero five m", so the row's
            clock carries the whole sentence and the tabular text is hidden from it. */}
        <span
          className={`num col-start-3 row-start-1 row-span-3 self-center justify-self-end rounded-button px-2.5 py-1.5 text-center text-rowclock whitespace-nowrap ${BAND_PILL[rowBand]} ${CELL_RESET}`}
        >
          <span className="sr-only">In the Emergency Department {spokenHours(hours)}</span>
          <span aria-hidden="true">{fmtHours(hours)}</span>
        </span>
      </Link>
    </li>
  )
}
