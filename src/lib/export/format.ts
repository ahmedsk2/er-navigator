/**
 * How a cell is written. Three rules, from the Phase 5 spec and the prototype's `ExportPanel`:
 * dates as `dd/mm HH:mm` in Asia/Riyadh, hours as a NUMBER rounded to two decimals (the workbook
 * formats the cell "8.00", and Excel can still sum and average the column: Ahmed, 10 September),
 * an empty string for anything missing (the prototype's `fmtDT` renders a dash on screen; a spreadsheet wants a blank cell so
 * a column can still be sorted and counted).
 *
 * The date formatter is the one the board and the case editor already use, so a timestamp reads
 * identically on a phone, on the handover sheet and in the workbook.
 */
import { fmtClock, fmtStamp } from '@/src/lib/cases/local-time'
import { riyadhParts } from '@/src/lib/domain/aggregates'
import { splitHours } from '@/src/lib/domain/time'
import { riyadhDateKey, riyadhDayStart } from './range'

export function fmtAt(at: Date | null | undefined): string {
  return at ? fmtStamp(at.toISOString()) : ''
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * `DD-MMM-YYYY` in Asia/Riyadh — the Adaa form's own date column, and the QCH sheet's.
 *
 * Spelled out from parts rather than through a locale format so it cannot come back as
 * `01 Sept 2026` or `1-Sep-2026` on a different ICU build: the receiving workbook parses it.
 */
export function fmtFormDate(at: Date | null | undefined): string {
  if (!at) return ''
  const { y, m, day } = riyadhParts(at)
  return `${pad2(day)}-${MONTHS[m - 1]}-${y}`
}

/** `hh:mm` in Asia/Riyadh, 24-hour — the form's time columns. */
export function fmtFormTime(at: Date | null | undefined): string {
  return at ? fmtClock(at) : ''
}

/**
 * A duration as `h:mm` text — the August sheet's `MOD()` cells, which read "2:30", not "2.50".
 * Rounds through `splitHours` so 1.9994 h is "2:00" and never "1:60".
 */
export function fmtHm(hours: number | null | undefined): string {
  if (hours == null || Number.isNaN(hours)) return ''
  const { hh, mm } = splitHours(hours)
  return `${hh}:${pad2(mm)}`
}

/**
 * The Adaa form's "Calendar Days later" columns: how many Riyadh calendar days after the
 * registration date the instant falls on. Blank for zero, as the form asks ("Enter if > 0"), and
 * blank when nothing was recorded. Measured between the two days' midnights, so an arrival at
 * 23:50 and a triage at 00:10 is one day later even though eighteen minutes passed.
 */
export function dayOffset(base: Date, at: Date | null | undefined): string {
  if (!at) return ''
  const days = Math.round(
    (riyadhDayStart(riyadhDateKey(at)).getTime() - riyadhDayStart(riyadhDateKey(base)).getTime()) / 864e5,
  )
  return days > 0 ? String(days) : ''
}

/** A numeric cell rounded to two decimals, or a blank. The writer gives every number the "0.00" format. */
export function fmtHours2(hours: number | null | undefined): number | '' {
  return hours == null || Number.isNaN(hours) ? '' : Math.round(hours * 100) / 100
}

/** The prototype's `c.isolation ? "Yes" : ""` — a blank, not a "No", so the column filters. */
export function yesOrBlank(value: boolean): string {
  return value ? 'Yes' : ''
}
