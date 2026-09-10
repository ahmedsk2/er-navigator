/**
 * Board arithmetic and board strings — ported from the prototype's `Board`, `lastActivity` and
 * `bandColor` (docs/reference/ERNavigatorTracker.jsx) onto `src/lib/domain/time.ts`.
 *
 * Everything here is pure and takes `now` as an argument. That is what lets the server compute
 * the first paint and the client recompute the same numbers on every 30 s tick without the two
 * ever disagreeing.
 */
import { DISPOSITION_LABELS, PAYER_LABELS } from '@/src/lib/domain/taxonomy'
import { band, duration, elapsedHours, fmtHours, type Band, type CaseClock } from '@/src/lib/domain/time'
import { BOARD_FILTERS, type BoardCounts, type BoardFilter, type BoardRow } from './types'

/** "No update for …" turns amber at two hours, not before (spec: phase3-board.md). */
export const STALE_AFTER_H = 2
/** The two thresholds the counts strip names. */
export const PAST_6_H = 6
export const PAST_12_H = 12
/** How often the board re-fetches and re-clocks itself. */
export const BOARD_POLL_MS = 30_000

/** `?f=` from the URL. Anything unknown — including `voided` — is the default Open board. */
export function parseFilter(value: string | null | undefined): BoardFilter {
  return (BOARD_FILTERS as ReadonlyArray<string>).includes(value ?? '') ? (value as BoardFilter) : 'open'
}

function clockOf(row: BoardRow): CaseClock {
  return {
    status: row.status,
    registrationAt: new Date(row.registrationAt),
    departedAt: row.departedAt ? new Date(row.departedAt) : null,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
  }
}

/** Elapsed ED stay in hours; null when there is no sane clock (leaving before registration). */
export function elapsedOf(row: BoardRow, now: Date): number | null {
  return elapsedHours(clockOf(row), now)
}

export function bandOf(row: BoardRow, now: Date): Band {
  return band(elapsedOf(row, now))
}

/** The prototype's `lastActivity`: the newest of the case row itself and its newest update. */
export function lastActivityAt(row: BoardRow): Date {
  const created = new Date(row.createdAt)
  if (!row.lastUpdateAt) return created
  const updated = new Date(row.lastUpdateAt)
  return updated.getTime() > created.getTime() ? updated : created
}

/** Hours since the last activity, on an open case only — a resolved case cannot go stale. */
export function idleHours(row: BoardRow, now: Date): number | null {
  if (row.status !== 'OPEN') return null
  return duration(lastActivityAt(row), now)
}

export function isStale(idle: number | null): boolean {
  return idle != null && idle >= STALE_AFTER_H
}

/** Line 3 of an open row. null when the row is not open, so the caller renders the outcome. */
export function stalenessText(idle: number | null): string | null {
  if (idle == null) return null
  return isStale(idle) ? `No update for ${fmtHours(idle)}` : `Updated ${fmtHours(idle)} ago`
}

/**
 * Longest stay first. A row with no elapsed time sorts last rather than to the top, and ties
 * keep the order the database returned, so a re-render never shuffles equal rows.
 */
export function sortByElapsed(rows: ReadonlyArray<BoardRow>, now: Date): BoardRow[] {
  return rows
    .map((row, index) => ({ row, index, hours: elapsedOf(row, now) }))
    .sort((a, b) => {
      if (a.hours == null || b.hours == null) {
        if (a.hours == null && b.hours == null) return a.index - b.index
        return a.hours == null ? 1 : -1
      }
      return b.hours - a.hours || a.index - b.index
    })
    .map((entry) => entry.row)
}

/** The prototype's search box: every non-digit is dropped before the MRN is matched. */
export function normalizeMrnQuery(query: string): string {
  return query.replace(/\D/g, '')
}

/** Substring match on the MRN. A query with no digits in it filters nothing out. */
export function searchRows(rows: ReadonlyArray<BoardRow>, query: string): BoardRow[] {
  const digits = normalizeMrnQuery(query)
  if (!digits) return [...rows]
  return rows.filter((row) => row.mrn.includes(digits))
}

/** "{open} open · {past6} past 6h · {past12} past 12h", always over the open cases. */
export function countsOf(openRegistrations: ReadonlyArray<string>, now: Date): BoardCounts {
  let past6 = 0
  let past12 = 0
  for (const iso of openRegistrations) {
    const hours = duration(new Date(iso), now)
    if (hours == null) continue
    if (hours >= PAST_6_H) past6 += 1
    if (hours >= PAST_12_H) past12 += 1
  }
  return { open: openRegistrations.length, past6, past12 }
}

/**
 * The small chips a row carries beside its MRN (Phase 8, the payer added in Phase 10): the CTAS
 * level, the ED area code and who pays, each only when it was recorded. One function so the
 * screen row and the printed handover sheet cannot drift apart, and so a case with none of them
 * shows nothing at all rather than three dashes.
 */
export function identityChips(row: BoardRow): string[] {
  const chips: string[] = []
  if (row.ctas != null) chips.push(`CTAS ${row.ctas}`)
  if (row.area) chips.push(row.area)
  if (row.payer) chips.push(PAYER_LABELS[row.payer])
  return chips
}

/** Line 2: the primary reason, then the consulted teams. */
export function reasonText(row: BoardRow): string {
  const reason = row.primaryReason ?? 'No reason set'
  return row.departments.length ? `${reason} · ${row.departments.join(', ')}` : reason
}

/**
 * A resolved case a supervisor has signed off (Phase 8b, decision H). Open cases are excluded on
 * purpose: a review is a reading of a finished record, and `saveCase` clears it the moment the
 * case is edited again, so a reviewed OPEN row would only ever be a case reopened after review.
 */
export function isReviewed(row: BoardRow): boolean {
  return row.status === 'RESOLVED' && row.reviewedAt !== null
}

/** Line 3 of a resolved row: what happened to the patient, and where they went. */
export function resolvedText(row: BoardRow): string {
  return [row.disposition ? DISPOSITION_LABELS[row.disposition] : null, row.ward]
    .filter((part): part is string => !!part)
    .join(' · ')
}
