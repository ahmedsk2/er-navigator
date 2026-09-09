/**
 * The dashboard's URL: `?r=` picks the range, `?drill=<section>:<name>` picks a case list.
 *
 * The prototype held the drill-down in React state (`setDrill({ label, ids })`). On the server it
 * has to survive a round trip, so the URL carries the section and the row's own name and the ids
 * are resolved again from the same `dashboard()` output the page just computed — never recounted,
 * never trusted from the query string. That also makes every drill-down a plain link: the page
 * works with JavaScript off, and a leadership screenshot of a drill-down is a real URL.
 *
 * Names are split on the FIRST colon only, because reason names contain colons of their own
 * ("Lab: delay in processing").
 */
import { RANGES, type Range } from '@/src/lib/domain/aggregates'
import { DISPOSITION_LABELS, INVESTIGATION_LABELS, SHIFT_LABELS } from '@/src/lib/domain/taxonomy'

export const DEFAULT_RANGE: Range = '30'

export const RANGE_LABELS: Record<Range, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  all: 'All time',
}

/** Every section of the page that can be drilled into. One per chart or table the prototype picks from. */
export const DRILL_SECTIONS = [
  'threshold',
  'week',
  'primary',
  'stage',
  'dept',
  'consult',
  'investigation',
  'shift',
  'weekday',
  'dispo',
] as const
export type DrillSection = (typeof DRILL_SECTIONS)[number]

export type DrillKey = { section: DrillSection; name: string }

/** A resolved drill-down: the heading the prototype shows, and the case ids behind the row. */
export type Drill = { key: DrillKey; label: string; ids: string[] }

/** `?r=`. Anything unknown is the default 30 days, exactly as the prototype opens. */
export function parseRange(value: string | string[] | null | undefined): Range {
  const raw = Array.isArray(value) ? value[0] : value
  return (RANGES as ReadonlyArray<string>).includes(raw ?? '') ? (raw as Range) : DEFAULT_RANGE
}

/** `?drill=`. null for anything this page cannot resolve, which the page renders as no drill-down. */
export function parseDrill(value: string | string[] | null | undefined): DrillKey | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const colon = raw.indexOf(':')
  if (colon <= 0) return null
  const section = raw.slice(0, colon)
  const name = raw.slice(colon + 1)
  if (!name) return null
  if (!(DRILL_SECTIONS as ReadonlyArray<string>).includes(section)) return null
  return { section: section as DrillSection, name }
}

export function drillKey(section: DrillSection, name: string | number): string {
  return `${section}:${name}`
}

/** The canonical URL for a range, with or without a drill-down. `r=30` is left implicit. */
export function dashboardHref(range: Range, drill?: string | null): string {
  const params = new URLSearchParams()
  if (range !== DEFAULT_RANGE) params.set('r', range)
  if (drill) params.set('drill', drill)
  const search = params.toString()
  return search ? `/dashboard?${search}` : '/dashboard'
}

/** Everything `dashboard()` returns; the drill-down reads its rows rather than counting again. */
type DashboardData = {
  thresholds: ReadonlyArray<{ threshold: number; allIds: string[] }>
  weeks: ReadonlyArray<{ weekStart: string; ids: string[] }>
  byPrimary: ReadonlyArray<{ name: string; ids: string[] }>
  byStage: ReadonlyArray<{ name: string; ids: string[] }>
  byDept: ReadonlyArray<{ name: string; ids: string[] }>
  consults: ReadonlyArray<{ name: string; ids: string[] }>
  investigations: ReadonlyArray<{ type: string; name: string; ids: string[] }>
  byShift: ReadonlyArray<{ name: string; ids: string[] }>
  byWeekday: ReadonlyArray<{ name: string; ids: string[] }>
  byDispo: ReadonlyArray<{ name: string; ids: string[] }>
}

/**
 * Resolve a key against this render's aggregates. A key whose section is known but whose row is
 * not in range any more (a team with no consults in the last 7 days) resolves to null and falls
 * back to the dashboard, which is what the prototype's in-memory drill did by construction.
 */
export function resolveDrill(data: DashboardData, key: DrillKey): Drill | null {
  const named = <T extends { name: string; ids: string[] }>(
    rows: ReadonlyArray<T>,
    label?: (row: T) => string,
  ): Drill | null => {
    const row = rows.find((r) => r.name === key.name)
    return row ? { key, label: label ? label(row) : row.name, ids: row.ids } : null
  }

  switch (key.section) {
    case 'threshold': {
      const row = data.thresholds.find((r) => String(r.threshold) === key.name)
      return row ? { key, label: `Cases over ${row.threshold}h`, ids: row.allIds } : null
    }
    case 'week': {
      const row = data.weeks.find((r) => r.weekStart === key.name)
      return row ? { key, label: `Week of ${row.weekStart}`, ids: row.ids } : null
    }
    case 'primary':
      return named(data.byPrimary)
    case 'stage':
      return named(data.byStage)
    case 'dept':
      return named(data.byDept)
    case 'consult':
      return named(data.consults)
    case 'investigation': {
      const row = data.investigations.find((r) => r.type === key.name)
      return row ? { key, label: row.name, ids: row.ids } : null
    }
    case 'shift':
      return named(data.byShift, (r) => `${SHIFT_LABELS[r.name as keyof typeof SHIFT_LABELS]} shift`)
    case 'weekday':
      return named(data.byWeekday)
    case 'dispo':
      return named(data.byDispo, (r) => DISPOSITION_LABELS[r.name as keyof typeof DISPOSITION_LABELS] ?? r.name)
  }
}

/** Display name for an investigation type, used by the table and its drill-down alike. */
export function investigationLabel(type: string): string {
  return INVESTIGATION_LABELS[type as keyof typeof INVESTIGATION_LABELS] ?? type
}
