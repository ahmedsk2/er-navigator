/**
 * The case filter (Phase 10, Ahmed's request 4): the seven dimensions a nurse can narrow the
 * board, the dashboard and the export by, carried in the address so a filtered view is a link.
 *
 * Pure, like `aggregates.ts` and for the same reason: the board applies it to `BoardRow`s the
 * query already returned, the dashboard applies it to `CaseForStats` before a single number is
 * computed, and the export applies it to the rows the workbook is written from. Three callers,
 * one predicate — which is what makes "the count on /export equals the rows in the file" true by
 * construction rather than by care.
 *
 * Semantics, exactly as the spec fixes them:
 *
 *   - within a dimension the values are OR ("stage = Admission process or Investigations");
 *   - across dimensions they are AND;
 *   - `lone` ("the lone finding") holds the three multi-valued dimensions — stage, reason and
 *     consulted team — to a set EQUAL to the selection, so "Admission process, and nothing else
 *     was going on" is askable. The single-valued dimensions have one value each and behave the
 *     same either way;
 *   - `not` negates the whole match, after everything else.
 *
 * An empty filter matches every case, `not` included: `not` is a modifier on a selection, never a
 * selection of its own, and "exclude nothing" is not an empty board.
 *
 * Anything the query string carries that this module cannot use is dropped and the page still
 * renders — the same rule `parseDrill` follows, and for the same reason: a stale bookmark is not
 * an error.
 */
import type { Payer } from './aggregates'
import { DISPOSITION_LABELS, PAYER_LABELS, PAYERS } from './taxonomy'

/** The dispositions, as a literal union off the label table, so the two cannot drift. */
export type Disposition = keyof typeof DISPOSITION_LABELS

export type CaseFilter = {
  /** Stage CODES (reg, triage, …), never names: an Admin may rename a stage, and a link must survive it. */
  stage: string[]
  /** Reason names, which is what the case carries and what the chips show. */
  reason: string[]
  /** Consulted department names. */
  dept: string[]
  /** ED area codes (RESUS, RAZ …), for the same reason stages are codes. */
  area: string[]
  ctas: number[]
  payer: Payer[]
  dispo: Disposition[]
  /** Exclude the matching cases instead of keeping them. */
  not: boolean
  /** "The lone finding": the case's own set equals the selection, for the multi-valued dimensions. */
  lone: boolean
}

/** The seven dimensions, in the order the query string emits them and the panel lists them. */
export const FILTER_DIMENSIONS = ['stage', 'reason', 'dept', 'area', 'ctas', 'payer', 'dispo'] as const
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number]

/** What the panel calls each group, and what a chip is prefixed with. */
export const FILTER_LABELS: Record<FilterDimension, string> = {
  stage: 'Stage',
  reason: 'Reason',
  dept: 'Team',
  area: 'ED area',
  ctas: 'CTAS',
  payer: 'Payer',
  dispo: 'Outcome',
}

export const EMPTY_FILTER: CaseFilter = {
  stage: [],
  reason: [],
  dept: [],
  area: [],
  ctas: [],
  payer: [],
  dispo: [],
  not: false,
  lone: false,
}

/** Nothing selected. The two modes do not count: alone they say nothing about which cases to keep. */
export function isEmptyFilter(filter: CaseFilter): boolean {
  return FILTER_DIMENSIONS.every((key) => filter[key].length === 0)
}

/** Either shape a page can hand us: a route handler's `URLSearchParams`, or Next's `searchParams`. */
export type FilterParams = URLSearchParams | Record<string, string | string[] | undefined>

function valuesOf(params: FilterParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key)
  const raw = params[key]
  if (raw == null) return []
  return Array.isArray(raw) ? raw : [raw]
}

const distinct = <T>(values: ReadonlyArray<T>): T[] => [...new Set(values)]

/** A CTAS level is 1..5 and nothing else; "3.5", "0" and "three" are not levels the app records. */
function parseCtas(raw: string): number | null {
  if (!/^[1-5]$/.test(raw)) return null
  return Number(raw)
}

const isPayer = (raw: string): raw is Payer => (PAYERS as ReadonlyArray<string>).includes(raw)
const isDisposition = (raw: string): raw is Disposition =>
  Object.prototype.hasOwnProperty.call(DISPOSITION_LABELS, raw)

/** `?stage=adm&stage=inv&ctas=3&not=1`. Unknown values are dropped; the page still renders. */
export function parseCaseFilter(params: FilterParams): CaseFilter {
  const text = (key: FilterDimension): string[] =>
    distinct(valuesOf(params, key).map((v) => v.trim()).filter((v) => v !== ''))

  return {
    stage: text('stage'),
    reason: text('reason'),
    dept: text('dept'),
    area: text('area'),
    ctas: distinct(valuesOf(params, 'ctas').map(parseCtas).filter((v): v is number => v != null)),
    payer: distinct(valuesOf(params, 'payer').filter(isPayer)),
    dispo: distinct(valuesOf(params, 'dispo').filter(isDisposition)),
    // Exactly "1", so a hand-typed `not=yes` is ignored rather than half-honoured.
    not: valuesOf(params, 'not').includes('1'),
    lone: valuesOf(params, 'lone').includes('1'),
  }
}

/**
 * The filter's own query string, with no leading `?` and nothing at all for an empty filter —
 * which is what keeps `/`, `/dashboard` and the export's pinned strings byte-for-byte what they
 * were before this phase.
 */
export function caseFilterQuery(filter: CaseFilter): string {
  if (isEmptyFilter(filter)) return ''
  const params = new URLSearchParams()
  for (const key of FILTER_DIMENSIONS) for (const value of filter[key]) params.append(key, String(value))
  if (filter.not) params.set('not', '1')
  if (filter.lone) params.set('lone', '1')
  return params.toString()
}

/** Exactly the fields the predicate reads: a structural subset of `CaseForStats` and of a board row. */
export type FilterableCase = {
  stageCodes: ReadonlyArray<string>
  reasonNames: ReadonlyArray<string>
  departmentNames: ReadonlyArray<string>
  areaCode: string | null
  ctas: number | null
  payer: Payer | null
  /** The prisma enum as a plain string, which is how `CaseForStats` carries it. */
  disposition: string | null
}

/** OR over the selection; with `lone`, the case's own set must equal it. */
function matchesMulti(have: ReadonlyArray<string>, selected: ReadonlyArray<string>, lone: boolean): boolean {
  if (selected.length === 0) return true
  const set = new Set(have)
  if (lone) return set.size === selected.length && selected.every((value) => set.has(value))
  return selected.some((value) => set.has(value))
}

/**
 * One recorded value against the selection. A case that recorded nothing is not a match: "payer =
 * Insured" asks for the insured cases, not for those plus every case nobody typed a payer on.
 */
function matchesOne<T>(value: T | null, selected: ReadonlyArray<T>): boolean {
  if (selected.length === 0) return true
  return value != null && selected.includes(value)
}

export function matchesFilter(c: FilterableCase, filter: CaseFilter): boolean {
  if (isEmptyFilter(filter)) return true
  const hit =
    matchesMulti(c.stageCodes, filter.stage, filter.lone) &&
    matchesMulti(c.reasonNames, filter.reason, filter.lone) &&
    matchesMulti(c.departmentNames, filter.dept, filter.lone) &&
    matchesOne(c.areaCode, filter.area) &&
    matchesOne(c.ctas, filter.ctas) &&
    matchesOne(c.payer, filter.payer) &&
    matchesOne(c.disposition as Disposition | null, filter.dispo)
  return filter.not ? !hit : hit
}

/**
 * The two reference lists a label needs. Structural, so `ReferenceData` from
 * `src/lib/cases/reference.ts` satisfies it without this module importing anything of the sort.
 */
export type FilterReference = {
  stages: ReadonlyArray<{ code: string; name: string }>
  areas: ReadonlyArray<{ code: string; name: string }>
}

/**
 * What the panel offers, built once per request from `loadReference()` and handed to the bar as
 * plain JSON. A slim shape on purpose: the editor's reference carries ids, `requiresDepartment`
 * and the retired flags, none of which a filter has any use for, and all of which would cross the
 * RSC boundary on three pages for nothing.
 *
 * It satisfies `FilterReference` structurally, so the same object labels the chips.
 */
export type FilterOptions = {
  stages: ReadonlyArray<{ code: string; name: string; reasons: ReadonlyArray<string> }>
  /**
   * The reason names more than one stage carries — in the seeded taxonomy, every stage's "Other".
   * A reason is keyed by its name in the address and in `matchesFilter`, so `reason=Other` is one
   * value that matches an Other under any stage, as "By primary reason" counts it as one row. The
   * panel offers each of these once, under "Any stage", and not under each stage in `stages`, where
   * ten chips were one value and lit all together (Phase 10 review).
   */
  anyStageReasons: ReadonlyArray<string>
  departments: ReadonlyArray<string>
  areas: ReadonlyArray<{ code: string; name: string }>
}

/** `ReferenceData` → the options, structurally, so this module still imports nothing of the sort. */
export function filterOptionsOf(reference: {
  stages: ReadonlyArray<{ code: string; name: string; reasons: ReadonlyArray<{ name: string }> }>
  departments: ReadonlyArray<{ name: string }>
  areas: ReadonlyArray<{ code: string; name: string }>
}): FilterOptions {
  const stages = reference.stages.map((stage) => ({
    code: stage.code,
    name: stage.name,
    reasons: stage.reasons.map((reason) => reason.name),
  }))
  // How many stages carry each name. A stage cannot carry one twice (`@@unique([stageId, name])`).
  const carriers = new Map<string, number>()
  for (const stage of stages) for (const name of stage.reasons) carriers.set(name, (carriers.get(name) ?? 0) + 1)
  return {
    stages,
    anyStageReasons: [...carriers].filter(([, count]) => count > 1).map(([name]) => name),
    departments: reference.departments.map((department) => department.name),
    areas: reference.areas.map((area) => ({ code: area.code, name: area.name })),
  }
}

/** One removable chip: which dimension it came from, its stored value, and what it reads as. */
export type FilterChip = { dimension: FilterDimension; value: string; label: string }

/** What a chip says before its value — shorter than the panel's group names where a chip is narrow. */
const CHIP_PREFIX: Record<FilterDimension, string> = {
  stage: 'Stage: ',
  reason: 'Reason: ',
  dept: 'Team: ',
  area: 'Area: ',
  ctas: 'CTAS ',
  payer: 'Payer: ',
  dispo: 'Outcome: ',
}

/** The dimensions a case can carry several values in, and so the three `lone` holds to a set. */
const MULTI_VALUED: ReadonlySet<FilterDimension> = new Set(['stage', 'reason', 'dept'])

function nameFor(dimension: FilterDimension, value: string, reference: FilterReference): string {
  switch (dimension) {
    // A code is what the URL carries and a name is what a nurse reads; a code with no row left in
    // the reference (an Admin deactivated it) still shows, as itself, rather than vanishing.
    case 'stage':
      return reference.stages.find((s) => s.code === value)?.name ?? value
    case 'area':
      return reference.areas.find((a) => a.code === value)?.name ?? value
    case 'reason':
    case 'dept':
    case 'ctas':
      return value
    case 'payer':
      return PAYER_LABELS[value as Payer] ?? value
    case 'dispo':
      return DISPOSITION_LABELS[value as Disposition] ?? value
  }
}

/** The active filter as chips, in dimension order — what the bar draws beside the Filter button. */
export function filterChips(filter: CaseFilter, reference: FilterReference): FilterChip[] {
  const chips: FilterChip[] = []
  for (const dimension of FILTER_DIMENSIONS) {
    for (const value of filter[dimension]) {
      const text = String(value)
      const label = `${CHIP_PREFIX[dimension]}${nameFor(dimension, text, reference)}`
      chips.push({ dimension, value: text, label })
    }
  }
  return chips
}

/**
 * One sentence for the dashboard's footnote, the printed report's filter line and the workbook's
 * "Case filter" row. It has to say what `matchesFilter` does, so it is grouped the way the
 * predicate is rather than chip by chip:
 *
 *   - one part per dimension, in dimension order, its values joined by "or" — or by "and" under
 *     `lone` for stage, reason and team, where the case's own set must be exactly those;
 *   - the parts joined by " · ", as the chips read;
 *   - `not` over one part is "Excluding Stage: …"; over two or more it is "Excluding cases with
 *     … and …", because only a case matching ALL of them is left out, and "Excluding A · B" read
 *     as two exclusions.
 */
export function describeFilter(filter: CaseFilter, reference: FilterReference): string {
  if (isEmptyFilter(filter)) return ''
  const parts = FILTER_DIMENSIONS.filter((dimension) => filter[dimension].length > 0).map((dimension) => {
    const names = filter[dimension].map((value) => nameFor(dimension, String(value), reference))
    const joiner = filter.lone && MULTI_VALUED.has(dimension) ? ' and ' : ' or '
    return `${CHIP_PREFIX[dimension]}${names.join(joiner)}`
  })
  const sentence = !filter.not
    ? parts.join(' · ')
    : parts.length === 1
      ? `Excluding ${parts[0]}`
      : `Excluding cases with ${parts.join(' and ')}`
  return filter.lone ? `${sentence} · the lone finding` : sentence
}

/**
 * Drop one value — what tapping a chip's × does. Taking the last one out clears the two modes as
 * well, so "remove every chip" and "Clear" land on the same empty filter and the same URL.
 */
export function withoutFilterValue(filter: CaseFilter, dimension: FilterDimension, value: string): CaseFilter {
  const next: CaseFilter = {
    ...filter,
    [dimension]: (filter[dimension] as ReadonlyArray<string | number>).filter((v) => String(v) !== value),
  }
  return isEmptyFilter(next) ? EMPTY_FILTER : next
}
