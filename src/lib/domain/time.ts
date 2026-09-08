/**
 * Duration formulas — ported exactly from the validated prototype
 * (docs/reference/ERNavigatorTracker.jsx: hoursBetween, endTime, elapsedHours, bandColor,
 * median) and plan §4. Pure functions, no I/O, no timezone: callers pass Date objects;
 * bucketing in Asia/Riyadh happens in the aggregate layer.
 */

/** 'none' is the prototype's neutral "no data" colour (bandColor(null) → C.line), not green. */
export type Band = 'none' | 'ok' | 'h4' | 'h6' | 'h12' | 'h24'

/** Hours from a to b. null when either side is missing or b is before a. Never negative. */
export function duration(a?: Date | null, b?: Date | null): number | null {
  if (!a || !b) return null
  const h = (b.getTime() - a.getTime()) / 36e5
  return h < 0 ? null : h
}

export type CaseClock = {
  status: 'OPEN' | 'RESOLVED' | 'VOIDED'
  registrationAt: Date
  departedAt?: Date | null
  resolvedAt?: Date | null
}

/** RESOLVED: departedAt ?? resolvedAt. OPEN (and VOIDED): null. */
export function endAt(c: CaseClock): Date | null {
  if (c.status !== 'RESOLVED') return null
  return c.departedAt ?? c.resolvedAt ?? null
}

/** Elapsed ED stay in hours: registration to (end ?? now). */
export function elapsedHours(c: CaseClock, now: Date): number | null {
  return duration(c.registrationAt, endAt(c) ?? now)
}

export function band(h: number | null): Band {
  if (h == null) return 'none'
  if (h >= 24) return 'h24'
  if (h >= 12) return 'h12'
  if (h >= 6) return 'h6'
  if (h >= 4) return 'h4'
  return 'ok'
}

/** Minimum n for any median to render as a number. Below this the UI shows "n<3". */
export const MIN_N = 3

/** Median ignoring nulls/NaN. null if nothing left. */
export function median(xs: ReadonlyArray<number | null | undefined>): number | null {
  const a = xs
    .filter((x): x is number => typeof x === 'number' && !Number.isNaN(x))
    .sort((x, y) => x - y)
  if (a.length === 0) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}

/** "6h 05m" style, tabular; a dash for null. */
export function fmtHours(h: number | null): string {
  if (h == null || Number.isNaN(h)) return '–'
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}h ${String(mm).padStart(2, '0')}m`
}
