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
import { caseFilterQuery, type CaseFilter } from '@/src/lib/domain/case-filter'
import { NOT_RECORDED } from '@/src/lib/domain/kpi'
import { DISPOSITION_LABELS, INVESTIGATION_LABELS, SHIFT_LABELS } from '@/src/lib/domain/taxonomy'

export const DEFAULT_RANGE: Range = '30'

export const RANGE_LABELS: Record<Range, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  all: 'All time',
}

/**
 * Every section of the page that can be drilled into. One per chart or table the prototype picks
 * from, plus one per Phase 8 count row.
 *
 * Three of them are a grid rather than a list, so their row name carries both coordinates joined
 * by a pipe: `unitband:ICU|≤30 min`, `turnaround:CT|61–90 min`, `painkiller:band|≤30 min`. The
 * pipe is safe where a colon is not — `parseDrill` splits on the first colon because reason names
 * contain colons of their own, and no band, unit or investigation type contains a pipe.
 *
 * Phase 8b added `painkiller` (the Adaa pain block: the four door-to-painkiller bands under
 * `band`, the three pethidine doses under `dose`) and `communication` (decision D's two discharge
 * answers). The three new documentation rows need no section of their own: they are `completeness`
 * rows, and `quality` already resolves the whole list by name.
 */
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
  'stayband',
  'treated',
  'painkiller',
  'communication',
  'target',
  'unitband',
  'turnaround',
  'examconsult',
  'action',
  'outcome',
  'ctas',
  'area',
  'phase',
  'payer',
  'repeat',
  'quality',
] as const
export type DrillSection = (typeof DRILL_SECTIONS)[number]

/** The two-coordinate key the admission-to-unit and turnaround grids use. */
export function gridKey(a: string, b: string): string {
  return `${a}|${b}`
}

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

/**
 * The canonical URL for a range, with or without a drill-down. `r=30` is left implicit.
 *
 * The Phase 10 case filter is appended after both, and an empty one adds nothing — so every link
 * on an unfiltered dashboard is the string it was before the filter existed, and every link on a
 * filtered one carries the filter, which is what makes a drill-down stay inside the population
 * the reader was looking at.
 */
export function dashboardHref(range: Range, drill?: string | null, filter?: CaseFilter): string {
  const params = new URLSearchParams()
  if (range !== DEFAULT_RANGE) params.set('r', range)
  if (drill) params.set('drill', drill)
  const search = [params.toString(), filter ? caseFilterQuery(filter) : ''].filter(Boolean).join('&')
  return search ? `/dashboard?${search}` : '/dashboard'
}

type NamedRows = ReadonlyArray<{ name: string; ids: string[] }>

/** Everything `dashboard()` returns; the drill-down reads its rows rather than counting again. */
type DashboardData = {
  thresholds: ReadonlyArray<{ threshold: number; allIds: string[] }>
  weeks: ReadonlyArray<{ weekStart: string; ids: string[] }>
  byPrimary: NamedRows
  byStage: NamedRows
  byDept: NamedRows
  consults: NamedRows
  investigations: ReadonlyArray<{ type: string; name: string; ids: string[] }>
  byShift: NamedRows
  byWeekday: NamedRows
  byDispo: NamedRows
  kpi: {
    stayBands: NamedRows
    treated: NamedRows
    painkiller: NamedRows
    pethidine: NamedRows
    communication: NamedRows
    targets: ReadonlyArray<{ key: string; name: string; missedIds: string[] }>
    admissionToUnit: ReadonlyArray<{ unit: string; bands: NamedRows }>
    turnaround: ReadonlyArray<{ type: string; orderToResult: NamedRows }>
    examToConsult: NamedRows
    actions: { any: { name: string; ids: string[] }; none: { name: string; ids: string[] }; byKind: NamedRows }
    outcomes: NamedRows
    byCtas: NamedRows
    byArea: NamedRows
    /** Phase 10: the three phases, each with its measured ids, its longest-phase ids and its stage rows. */
    phases: { phases: ReadonlyArray<{ key: string; name: string; ids: string[]; longestIds: string[]; stages: NamedRows }> }
    byPayer: NamedRows
    repeats: ReadonlyArray<{ mrn: string; ids: string[] }>
    completeness: NamedRows
  }
}

/** "ICU-type" and "Ward" as the admission-to-unit section titles them. */
export const UNIT_LABELS: Record<string, string> = { ICU: 'ICU-type unit', Ward: 'Ward' }

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
    case 'stayband':
      return named(data.kpi.stayBands, (r) => `Stay ${r.name}`)
    case 'treated':
      return named(data.kpi.treated, (r) => `Door to disposition: ${r.name}`)
    case 'painkiller': {
      // One section for the whole Adaa pain block, split the way the two grids are: `band` is a
      // door-to-painkiller band, `dose` a pethidine dose. Anything else resolves to null.
      const [kind, name] = splitGrid(key.name)
      if (kind !== 'band' && kind !== 'dose') return null
      const rows = kind === 'band' ? data.kpi.painkiller : data.kpi.pethidine
      const row = rows.find((r) => r.name === name)
      if (!row) return null
      return { key, label: kind === 'band' ? `Door to painkiller ${row.name}` : `Pethidine ${row.name}`, ids: row.ids }
    }
    case 'communication':
      // The cases that answered the question, which is the `n` the share is drawn over; the bar
      // beside it is how many of them answered Yes.
      return named(data.kpi.communication, (r) => `${r.name}: recorded`)
    case 'target': {
      const row = data.kpi.targets.find((r) => r.key === key.name)
      return row ? { key, label: `Missed: ${row.name}`, ids: row.missedIds } : null
    }
    case 'unitband': {
      const [unit, band] = splitGrid(key.name)
      const group = data.kpi.admissionToUnit.find((g) => g.unit === unit)
      const row = group?.bands.find((b) => b.name === band)
      return row ? { key, label: `${UNIT_LABELS[unit] ?? unit}, admission order to left ED ${row.name}`, ids: row.ids } : null
    }
    case 'turnaround': {
      const [type, band] = splitGrid(key.name)
      const group = data.kpi.turnaround.find((g) => g.type === type)
      const row = group?.orderToResult.find((b) => b.name === band)
      return row ? { key, label: `${investigationLabel(type)} order to result ${row.name}`, ids: row.ids } : null
    }
    case 'examconsult':
      return named(data.kpi.examToConsult, (r) => `${r.name}: exam to consult`)
    case 'action': {
      const { any, none, byKind } = data.kpi.actions
      return named([any, none, ...byKind])
    }
    case 'outcome':
      return named(data.kpi.outcomes)
    case 'ctas':
      return named(data.kpi.byCtas, (r) => (r.name === NOT_RECORDED ? 'CTAS not recorded' : `CTAS ${r.name}`))
    case 'area':
      return named(data.kpi.byArea, (r) => (r.name === NOT_RECORDED ? 'ED area not recorded' : r.name))
    case 'phase': {
      // `phase|median`, `phase|longest`, or `phase|<stage name>`.
      const [phaseKey, what] = splitGrid(key.name)
      const phase = data.kpi.phases.phases.find((p) => p.key === phaseKey)
      if (!phase) return null
      if (what === 'median') return { key, label: `${phase.name}: cases with the interval measured`, ids: phase.ids }
      if (what === 'longest') return { key, label: `${phase.name}: the longest phase of the stay`, ids: phase.longestIds }
      const stage = phase.stages.find((s) => s.name === what)
      return stage ? { key, label: `${stage.name} (${phase.name.toLowerCase()})`, ids: stage.ids } : null
    }
    case 'payer':
      return named(data.kpi.byPayer, (r) => (r.name === NOT_RECORDED ? 'Payer not recorded' : `Payer: ${r.name}`))
    case 'repeat': {
      const row = data.kpi.repeats.find((r) => r.mrn === key.name)
      return row ? { key, label: `MRN ${row.mrn}, ${row.ids.length} visits`, ids: row.ids } : null
    }
    case 'quality':
      return named(data.kpi.completeness)
  }
}

/** `unit|band` back into its two halves. A name with no pipe yields an empty second half. */
function splitGrid(name: string): [string, string] {
  const pipe = name.indexOf('|')
  return pipe < 0 ? [name, ''] : [name.slice(0, pipe), name.slice(pipe + 1)]
}

/** Display name for an investigation type, used by the table and its drill-down alike. */
export function investigationLabel(type: string): string {
  return INVESTIGATION_LABELS[type as keyof typeof INVESTIGATION_LABELS] ?? type
}
