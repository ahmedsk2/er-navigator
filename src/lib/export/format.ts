/**
 * How a cell is written. Three rules, from the Phase 5 spec and the prototype's `ExportPanel`:
 * dates as `dd/mm HH:mm` in Asia/Riyadh, hours to two decimals, an empty string for anything
 * missing (the prototype's `fmtDT` renders a dash on screen; a spreadsheet wants a blank cell so
 * a column can still be sorted and counted).
 *
 * The date formatter is the one the board and the case editor already use, so a timestamp reads
 * identically on a phone, on the handover sheet and in the workbook.
 */
import { fmtStamp } from '@/src/lib/cases/local-time'

export function fmtAt(at: Date | null | undefined): string {
  return at ? fmtStamp(at.toISOString()) : ''
}

export function fmtHours2(hours: number | null | undefined): string {
  return hours == null || Number.isNaN(hours) ? '' : hours.toFixed(2)
}

/** The prototype's `c.isolation ? "Yes" : ""` — a blank, not a "No", so the column filters. */
export function yesOrBlank(value: boolean): string {
  return value ? 'Yes' : ''
}
