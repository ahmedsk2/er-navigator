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
 * One `<a>`, one grid, two templates. The phone places its cells explicitly — three stacked lines
 * beside a pill that spans them — and the laptop drops that placement and lets five columns fill
 * themselves in source order. The MRN, the chips and the stamp are one wrapping line on the phone
 * and the first two columns on the laptop, which is what the `lg:contents` wrapper buys: one
 * markup, no duplicated DOM. The text, the order and every `data-*` hook are what they were.
 *
 * The 6 px band stripe is gone. Its job — the threshold, read from across a corridor — is now the
 * elapsed clock itself, filled with the band's own colour (`BAND_PILL`, whose contrast with white
 * is recomputed from the token block by `src/components/__tests__/bands.test.ts`). One element
 * carrying the colour and the number beats two, and it survives the five-column row, where a
 * stripe on the far left would be 900 px from the time it describes.
 *
 * Phase 10 adds one control beside the card: the summary button, a sibling of the link inside the
 * `<li>`, standing in the gutter the desktop label strip now reserves as its sixth column.
 *
 * No `'use client'` of its own: the board renders it inside a client component, the dashboard
 * (Phase 4) reuses it from a server component, and it has no state either way. The summary button
 * is a client component of its own, which a server component may render.
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
import { RowSummaryButton } from './RowSummaryButton'

// Band → class maps live in src/components/bands.ts since Phase 9 (one copy for the three readers).

/**
 * The desktop template for the label strip `Board.tsx` draws above the list. Six columns for five
 * labels: the sixth is the gutter the row's summary button stands in (Phase 10), and leaving it
 * empty is what keeps "Last update" and "Elapsed" over the cells they name. Exported as a string
 * because Tailwind needs the literal in the class attribute.
 */
export const ROW_COLUMNS = 'lg:grid-cols-[140px_120px_minmax(0,1fr)_180px_110px_44px]'

/**
 * The card's own five columns. The same widths as the strip's first five, over a card that is
 * exactly the button and its gap narrower than the strip — so the two line up to the pixel while
 * the button sits outside the link, where a control nested in an anchor cannot be.
 */
const CARD_COLUMNS = 'lg:grid-cols-[140px_120px_minmax(0,1fr)_180px_110px]'

/** What a cell does on the phone, undone at `lg` so the five columns can fill themselves. */
const CELL_RESET = 'lg:col-start-auto lg:row-start-auto lg:col-span-1 lg:row-span-1'

export function BoardRowItem({ row, now }: { row: BoardRow; now: Date }) {
  const hours = elapsedOf(row, now)
  const rowBand = bandOf(row, now)
  const idle = idleHours(row, now)
  const stale = isStale(idle)
  const chips = identityChips(row)

  return (
    // The margins that used to sit on the card now sit here, because the card is no longer the
    // only child: the summary button is its sibling, never its descendant (a button inside an
    // anchor is invalid, and `a[data-mrn]` is counted per row in three specs).
    <li className="mx-4 my-2 flex items-center gap-2 lg:mx-0 lg:gap-3">
      <Link
        href={`/cases/${row.id}`}
        data-mrn={row.mrn}
        data-band={rowBand}
        className={`grid min-h-11 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-card border border-line-soft bg-panel p-3.5 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset lg:items-center lg:gap-y-0 lg:px-4 lg:py-3 ${CARD_COLUMNS}`}
      >
        {/*
          The identity line. On the phone the MRN, the chips and the registration stamp are one
          wrapping line, because they were one line in the prototype and because two grid cells on
          a 390 px screen squeeze the stamp into three words tall. At `lg` this wrapper becomes
          `display: contents` and its two children are the grid's first two columns — the same
          markup, no duplicate DOM, and the row still reads left to right in source order.
        */}
        <span
          className={`col-start-1 row-start-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 lg:contents ${CELL_RESET}`}
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
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

          {/* "reg" stays in the text at both widths. The laptop's strip above the list already
              says "Registered", but the same row is reused by the dashboard drill-down, which has
              no strip, and four characters are cheaper than a row that reads differently in two
              places. */}
          <span className="num text-caption text-muted">reg {fmtStamp(row.registrationAt)}</span>
        </span>

        {/*
          The "Waiting on" cell: the working diagnosis above the reason, both truncated to one
          line. They share one grid child on purpose — the laptop's five columns fill themselves
          in source order, so a second top-level child here would push the last update and the
          clock one column along.
        */}
        <span className={`col-start-1 row-start-2 mt-[3px] block min-w-0 lg:mt-0 ${CELL_RESET}`}>
          {row.diagnosis ? (
            <span data-diagnosis={row.diagnosis} className="block truncate text-caption text-ink-2">
              {row.diagnosis}
            </span>
          ) : null}
          <span className="block truncate text-label text-ink">{reasonText(row)}</span>
        </span>

        {row.status === 'RESOLVED' ? (
          <span
            className={`col-start-1 row-start-3 flex flex-wrap items-baseline gap-x-1.5 text-caption text-band-ok ${CELL_RESET}`}
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
            className={`num col-start-1 row-start-3 block text-caption ${stale ? 'font-semibold text-band-h4-ink' : 'text-muted'} ${CELL_RESET}`}
          >
            {stalenessText(idle)}
          </span>
        )}

        {/* The eye reads "6h 05m"; a screen reader would say "six h zero five m", so the row's
            clock carries the whole sentence and the tabular text is hidden from it. */}
        <span
          className={`num col-start-2 row-start-1 row-span-3 self-center justify-self-end rounded-button px-2.5 py-1.5 text-center text-rowclock whitespace-nowrap ${BAND_PILL[rowBand]} ${CELL_RESET}`}
        >
          <span className="sr-only">In the Emergency Department {spokenHours(hours)}</span>
          <span aria-hidden="true">{fmtHours(hours)}</span>
        </span>
      </Link>

      {/* Phase 10: "what is happening with this patient", without leaving the board. */}
      <RowSummaryButton caseId={row.id} mrn={row.mrn} />
    </li>
  )
}
