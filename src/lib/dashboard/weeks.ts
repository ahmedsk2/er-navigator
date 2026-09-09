import { MIN_N } from '@/src/lib/domain/time'

/** What `byWeek()` in src/lib/domain/aggregates.ts produces for one week; `med` is unguarded there. */
export type WeekAggregate = { name: string; cases: number; med: number | null }

export type WeekPoint = { name: string; cases: number; med: number | null; href: string }

/**
 * The weekly chart's data, with the hard rule applied: a median is only shown for n >= MIN_N.
 *
 * `byWeek()` computes a median for every week and leaves the guard to the UI (its header says
 * so), and every other median surface on the dashboard checks `n` before rendering. This is the
 * one place the weekly panel does the same, so a go-live week with one 41-hour case charts a gap
 * and a tooltip that says "n<3", not a dot claiming a median of 41 h. The case count is a count,
 * not a median, and is never suppressed.
 */
export function weekPoint(week: WeekAggregate, href: string): WeekPoint {
  return {
    name: week.name,
    cases: week.cases,
    med: week.cases < MIN_N ? null : week.med,
    href,
  }
}
