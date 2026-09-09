/**
 * The export's range: the two dates a nurse types, and the instants they actually mean.
 *
 * The prototype filtered on `c.registrationTime.slice(0, 10)` — the *local* calendar date of the
 * registration, compared as a string. On a server that runs in UTC that is not the same set of
 * cases: a patient registered at 01:00 Riyadh is still the previous UTC day. So the two date
 * inputs are read as Asia/Riyadh calendar days and turned into a half-open instant window
 * [midnight of `from`, midnight of the day after `to`), which is what the Prisma query filters on
 * and what the dashboard's own Riyadh bucketing already assumes.
 *
 * The zone offset is measured through `Intl` rather than hard-coded to +03:00: Saudi Arabia has
 * never observed DST, but nothing here needs to depend on that staying true.
 */
import { DAYS, TIMEZONE, riyadhParts } from '@/src/lib/domain/aggregates'

/** The status filter on the export page. VOIDED is never exported under any of them. */
export const EXPORT_STATUSES = ['open', 'resolved', 'all'] as const
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

export const DEFAULT_EXPORT_STATUS: ExportStatus = 'all'

export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  all: 'All',
}

/** Which `Case.status` values each filter admits. VOIDED appears in none of them, on purpose. */
export const EXPORT_STATUS_VALUES: Record<ExportStatus, ReadonlyArray<'OPEN' | 'RESOLVED'>> = {
  open: ['OPEN'],
  resolved: ['RESOLVED'],
  all: ['OPEN', 'RESOLVED'],
}

/** The prototype's default: `now - 7 days` to today, both as Riyadh calendar dates. */
export const DEFAULT_RANGE_DAYS = 7

export type ExportRange = { from: string; to: string; status: ExportStatus }

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number): string => String(n).padStart(2, '0')

/** The Asia/Riyadh calendar date of an instant, as `YYYY-MM-DD`. */
export function riyadhDateKey(at: Date): string {
  const { y, m, day } = riyadhParts(at)
  return `${y}-${pad(m)}-${pad(day)}`
}

/** "Sun".."Sat" for the Riyadh weekday of an instant — the Cases sheet's Weekday column. */
export function riyadhWeekday(at: Date): string {
  return DAYS[riyadhParts(at).weekday] ?? ''
}

const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** How far Asia/Riyadh is ahead of UTC at `at`, in milliseconds. */
function zoneOffsetMs(at: Date): number {
  const parts = zoneParts.formatToParts(at)
  const n = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const whole = Math.floor(at.getTime() / 1000) * 1000
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - whole
}

/**
 * Midnight of a Riyadh calendar day, as the UTC instant it happens at. Two passes so a zone that
 * did change offset overnight would still land on the day it was asked for.
 */
export function riyadhDayStart(key: string): Date {
  const m = DATE_KEY.exec(key)
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${key}`)
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const once = utcMidnight - zoneOffsetMs(new Date(utcMidnight))
  return new Date(utcMidnight - zoneOffsetMs(new Date(once)))
}

/** `YYYY-MM-DD` plus (or minus) whole days, in the calendar, not in instants. */
export function addDays(key: string, days: number): string {
  const m = DATE_KEY.exec(key)
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${key}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10)
}

/** The half-open instant window the query filters `registrationAt` on. */
export function riyadhDayBounds(from: string, to: string): { gte: Date; lt: Date } {
  return { gte: riyadhDayStart(from), lt: riyadhDayStart(addDays(to, 1)) }
}

/** A `YYYY-MM-DD` that is also a real date, or null. `2026-02-31` is rejected, not rolled over. */
export function parseDateKey(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !DATE_KEY.test(raw)) return null
  return riyadhDateKey(riyadhDayStart(raw)) === raw ? raw : null
}

export function parseExportStatus(value: string | string[] | null | undefined): ExportStatus {
  const raw = Array.isArray(value) ? value[0] : value
  return (EXPORT_STATUSES as ReadonlyArray<string>).includes(raw ?? '')
    ? (raw as ExportStatus)
    : DEFAULT_EXPORT_STATUS
}

export function defaultExportRange(now: Date): ExportRange {
  return {
    from: riyadhDateKey(new Date(now.getTime() - DEFAULT_RANGE_DAYS * 864e5)),
    to: riyadhDateKey(now),
    status: DEFAULT_EXPORT_STATUS,
  }
}

/** Anything missing or malformed falls back to the default range: a bad link is not an error. */
export function parseExportRange(
  params: { from?: string | string[]; to?: string | string[]; status?: string | string[] },
  now: Date,
): ExportRange {
  const fallback = defaultExportRange(now)
  return {
    from: parseDateKey(params.from) ?? fallback.from,
    to: parseDateKey(params.to) ?? fallback.to,
    status: parseExportStatus(params.status),
  }
}

export function exportRangeQuery(range: ExportRange): string {
  return new URLSearchParams({ from: range.from, to: range.to, status: range.status }).toString()
}

/** The prototype's filename, unchanged. */
export function exportFilename(range: ExportRange): string {
  return `ER_Navigator_${range.from}_to_${range.to}.xlsx`
}
