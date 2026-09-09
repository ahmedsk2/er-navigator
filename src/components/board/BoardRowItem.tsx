/**
 * One board row, the prototype's information design line for line (`Board`, the `.row` block):
 *
 *   [band] MRN  reg dd/mm HH:mm                                        6h 05m
 *          primary reason · consulted teams
 *          No update for 3h 10m   /   Admitted · ICU
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
import { fmtHours, spokenHours, type Band } from '@/src/lib/domain/time'

const BAND_BG: Record<Band, string> = {
  none: 'bg-band-none',
  ok: 'bg-band-ok',
  h4: 'bg-band-h4',
  h6: 'bg-band-h6',
  h12: 'bg-band-h12',
  h24: 'bg-band-h24',
}

/** The 4 h band is the one token too light for text; its ink variant is the text colour. */
const BAND_TEXT: Record<Band, string> = {
  none: 'text-muted',
  ok: 'text-band-ok',
  h4: 'text-band-h4-ink',
  h6: 'text-band-h6',
  h12: 'text-band-h12',
  h24: 'text-band-h24',
}

export function BoardRowItem({ row, now }: { row: BoardRow; now: Date }) {
  const hours = elapsedOf(row, now)
  const rowBand = bandOf(row, now)
  const idle = idleHours(row, now)
  const stale = isStale(idle)

  return (
    <li>
      <Link
        href={`/cases/${row.id}`}
        data-mrn={row.mrn}
        data-band={rowBand}
        className="flex min-h-11 items-stretch gap-3 border-b border-line bg-panel py-3 pr-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <span className={`w-1.5 shrink-0 rounded-r-[3px] ${BAND_BG[rowBand]}`} aria-hidden />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="num text-[16px] font-bold">{row.mrn}</span>
            {/* Phase 8: CTAS and the ED area, only when they were recorded, so a row that has
                neither reads exactly as it did before. */}
            {identityChips(row).map((chip) => (
              <span
                key={chip}
                data-chip={chip}
                className="num rounded-chip border border-line px-1.5 py-px text-caption text-ink-2"
              >
                {chip}
              </span>
            ))}
            <span className="num text-caption text-muted">reg {fmtStamp(row.registrationAt)}</span>
          </span>

          <span className="mt-[3px] block truncate text-label text-ink">{reasonText(row)}</span>

          {row.status === 'RESOLVED' ? (
            <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-caption text-band-ok">
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
              className={`num mt-0.5 block text-caption ${stale ? 'font-semibold text-band-h4-ink' : 'text-muted'}`}
            >
              {stalenessText(idle)}
            </span>
          )}
        </span>

        {/* The eye reads "6h 05m"; a screen reader would say "six h zero five m", so the row's
            clock carries the whole sentence and the tabular text is hidden from it. */}
        <span className={`num self-center whitespace-nowrap text-rowclock ${BAND_TEXT[rowBand]}`}>
          <span className="sr-only">In the Emergency Department {spokenHours(hours)}</span>
          <span aria-hidden="true">{fmtHours(hours)}</span>
        </span>
      </Link>
    </li>
  )
}
