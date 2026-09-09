/**
 * The Phase 8 numbers: what the weekly delayed-tickets deck, the monthly ER Journey deck and the
 * Adaa ED KPI form compute, over the cases this app tracks (`docs/specs/phase8-brief.md`).
 *
 * Pure functions over `KpiCase`, a structural subset of the dashboard's `CaseForStats`. Nothing
 * here renders, loads or rounds for display; every median honours `MIN_N` and comes back null
 * below it, and every count row carries the case ids for a drill-down. Every duration is
 * end minus start and is null when either end is missing or the order is impossible (a result
 * before its order), so a typo never becomes a negative KPI.
 */
import { MIN_N, elapsedHours, endAt, median, type CaseClock } from './time'
import {
  ADMISSION_STEPS,
  CONSULT_STEPS,
  DISPOSITION_LABELS,
  INVESTIGATION_LABELS,
  INVESTIGATION_STEPS,
  MILESTONES,
  TRANSFER_STEPS,
} from './taxonomy'

// --- inputs ----------------------------------------------------------------------------------

export type KpiConsult = {
  departmentName: string
  consultedAt: Date | null
  seenAt: Date | null
  repliedAt: Date | null
}

export type KpiInvestigationType = 'LAB' | 'CT' | 'US' | 'XR'

export type KpiInvestigation = {
  type: KpiInvestigationType
  orderedAt: Date | null
  collectedAt: Date | null
  receivedAt: Date | null
  doneAt: Date | null
  preliminaryAt: Date | null
  resultedAt: Date | null
}

export type KpiCase = CaseClock & {
  id: string
  mrn: string
  triageAt: Date | null
  roomAt?: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
  handoverAt: Date | null
  transferRequestedAt: Date | null
  transferAcceptedAt?: Date | null
  transportArrivedAt?: Date | null
  medAdminInformedAt: Date | null
  disposition: string | null
  wardCode: string | null
  ctas: number | null
  areaName: string | null
  stageNames: ReadonlyArray<string>
  updatesCount: number
  lastUpdateAt: Date | null
  consults: ReadonlyArray<KpiConsult>
  investigations: ReadonlyArray<KpiInvestigation>
}

export type IdRow = { name: string; value: number; ids: string[] }
export type ShareRow = { name: string; n: number; within: number; ids: string[]; withinIds: string[]; share: number | null }
export type StatRow = { name: string; n: number; ids: string[]; med: number | null }

// --- durations -------------------------------------------------------------------------------

/** Hours from a to b; null when either is missing or b is before a (an impossible order). */
export function hoursBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  return ms < 0 ? null : ms / 3_600_000
}

export function minutesBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  const h = hoursBetween(a, b)
  return h == null ? null : h * 60
}

/** The earlier of two optional instants. */
function earliest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null
  if (!b) return a
  return a.getTime() <= b.getTime() ? a : b
}

function guardedMedian(xs: ReadonlyArray<number>): number | null {
  return xs.length >= MIN_N ? median(xs) : null
}

function share(within: number, n: number): number | null {
  return n >= MIN_N ? within / n : null
}

function live(cases: ReadonlyArray<KpiCase>): KpiCase[] {
  return cases.filter((c) => c.status !== 'VOIDED')
}

function unique(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids)]
}

type Band = { name: string; min: number; max: number | null }

/** Half-open bands [min, max); `max: null` is open-ended. `min: 0` catches everything below. */
function bandRows(bands: ReadonlyArray<Band>, values: ReadonlyArray<{ id: string; v: number }>): IdRow[] {
  return bands.map((b) => {
    const ids = values.filter(({ v }) => v >= b.min && (b.max == null || v < b.max)).map(({ id }) => id)
    return { name: b.name, value: ids.length, ids }
  })
}

// --- the weekly deck -------------------------------------------------------------------------

export const STAY_BANDS: ReadonlyArray<Band> = [
  { name: '<6 h', min: 0, max: 6 },
  { name: '6–<8 h', min: 6, max: 8 },
  { name: '8–<10 h', min: 8, max: 10 },
  { name: '10–<12 h', min: 10, max: 12 },
  { name: '12–<24 h', min: 12, max: 24 },
  { name: '24+ h', min: 24, max: null },
]

function stayValues(cases: ReadonlyArray<KpiCase>, now: Date): Array<{ id: string; mrn: string; v: number; c: KpiCase }> {
  const out: Array<{ id: string; mrn: string; v: number; c: KpiCase }> = []
  for (const c of live(cases)) {
    const h = elapsedHours(c, now)
    if (h != null) out.push({ id: c.id, mrn: c.mrn, v: h, c })
  }
  return out
}

export function stayBands(cases: ReadonlyArray<KpiCase>, now: Date): IdRow[] {
  return bandRows(STAY_BANDS, stayValues(cases, now))
}

export type Headline = {
  cases: number
  episodes: number
  med: number | null
  mean: number | null
  min: number | null
  max: number | null
  atLeast10: number
  atLeast12: number
  longest: { id: string; mrn: string; hours: number } | null
}

export function headline(cases: ReadonlyArray<KpiCase>, now: Date): Headline {
  const alive = live(cases)
  const values = stayValues(alive, now)
  const hours = values.map((x) => x.v)
  const enough = hours.length >= MIN_N
  const longest = values.reduce<(typeof values)[number] | null>((best, x) => (best == null || x.v > best.v ? x : best), null)
  return {
    cases: alive.length,
    episodes: new Set(alive.map((c) => c.mrn)).size,
    med: guardedMedian(hours),
    mean: enough ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    min: enough ? Math.min(...hours) : null,
    max: enough ? Math.max(...hours) : null,
    atLeast10: hours.filter((h) => h >= 10).length,
    atLeast12: hours.filter((h) => h >= 12).length,
    longest: longest ? { id: longest.id, mrn: longest.mrn, hours: longest.v } : null,
  }
}

export type KpiRange = '7' | '30' | '90' | 'all'

/**
 * The period of the same length immediately before `inRange`'s window (registration within the
 * last N days of `now`): registrations older than N days and at most 2N days old. Empty for
 * 'all', which has no "before".
 */
export function previousRange(all: ReadonlyArray<KpiCase>, range: KpiRange, now: Date): KpiCase[] {
  if (range === 'all') return []
  const ms = Number(range) * 864e5
  return live(all).filter((c) => {
    const age = now.getTime() - c.registrationAt.getTime()
    return age > ms && age <= 2 * ms
  })
}

export type LongestStay = {
  id: string
  mrn: string
  hours: number
  status: KpiCase['status']
  stageNames: ReadonlyArray<string>
  disposition: string | null
  lastUpdateAt: Date | null
}

export function longestStays(cases: ReadonlyArray<KpiCase>, now: Date, n = 10): LongestStay[] {
  return stayValues(cases, now)
    .sort((a, b) => b.v - a.v || a.mrn.localeCompare(b.mrn))
    .slice(0, n)
    .map(({ c, v }) => ({
      id: c.id,
      mrn: c.mrn,
      hours: v,
      status: c.status,
      stageNames: c.stageNames,
      disposition: c.disposition,
      lastUpdateAt: c.lastUpdateAt,
    }))
}

export const ACTION_KINDS = [
  ['update', 'Update written'],
  ['escalation', 'Medical admin informed'],
  ['bed', 'Bed requested (fax)'],
  ['transfer', 'Transfer requested'],
] as const

export type Actions = { any: IdRow; none: IdRow; byKind: IdRow[] }

function actionKindsOf(c: KpiCase): string[] {
  const kinds: string[] = []
  if (c.updatesCount > 0) kinds.push('update')
  if (c.medAdminInformedAt) kinds.push('escalation')
  if (c.bedRequestedAt) kinds.push('bed')
  if (c.transferRequestedAt) kinds.push('transfer')
  return kinds
}

/** The deck's "operational responses": which cases carry a documented action, and of what kind. */
export function actionsDocumented(cases: ReadonlyArray<KpiCase>): Actions {
  const alive = live(cases)
  const withAny = alive.filter((c) => actionKindsOf(c).length > 0)
  const withNone = alive.filter((c) => actionKindsOf(c).length === 0)
  return {
    any: { name: 'Action documented', value: withAny.length, ids: withAny.map((c) => c.id) },
    none: { name: 'No action documented', value: withNone.length, ids: withNone.map((c) => c.id) },
    byKind: ACTION_KINDS.map(([kind, name]) => {
      const ids = alive.filter((c) => actionKindsOf(c).includes(kind)).map((c) => c.id)
      return { name, value: ids.length, ids }
    }),
  }
}

export const STILL_OPEN = 'Still open'

/** Resolved cases by disposition (largest first), then the open ones as one row. */
export function outcomes(cases: ReadonlyArray<KpiCase>): IdRow[] {
  const alive = live(cases)
  const m = new Map<string, string[]>()
  for (const c of alive) {
    if (c.status !== 'RESOLVED') continue
    const label = c.disposition ? ((DISPOSITION_LABELS as Record<string, string>)[c.disposition] ?? c.disposition) : 'Not recorded'
    ;(m.get(label) ?? m.set(label, []).get(label)!).push(c.id)
  }
  const rows = [...m.entries()]
    .map(([name, ids]) => ({ name, value: ids.length, ids }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  const open = alive.filter((c) => c.status === 'OPEN').map((c) => c.id)
  if (open.length > 0) rows.push({ name: STILL_OPEN, value: open.length, ids: open })
  return rows
}

export type Completeness = { noReason: IdRow; openQuiet12h: IdRow; resolvedNoDisposition: IdRow; outOfOrder: IdRow }

/** True when every recorded instant in the sequence is at or after the one before it. */
function inOrder(seq: ReadonlyArray<Date | null | undefined>): boolean {
  let last: Date | null = null
  for (const d of seq) {
    if (!d) continue
    if (last && d.getTime() < last.getTime()) return false
    last = d
  }
  return true
}

export function isOutOfOrder(c: KpiCase): boolean {
  if (!inOrder([c.registrationAt, c.triageAt, c.roomAt, c.physicianAt, c.decisionAt, endAt(c)])) return true
  if (!inOrder([c.admOrderAt, c.bedRequestedAt, c.bedAssignedAt, c.handoverAt])) return true
  if (!inOrder([c.transferRequestedAt, c.transferAcceptedAt, c.transportArrivedAt])) return true
  for (const k of c.consults) if (!inOrder([k.consultedAt, k.seenAt, k.repliedAt])) return true
  for (const i of c.investigations) {
    const seq =
      i.type === 'LAB'
        ? [i.orderedAt, i.collectedAt, i.receivedAt, i.resultedAt]
        : [i.orderedAt, i.doneAt, i.preliminaryAt, i.resultedAt]
    if (!inOrder(seq)) return true
  }
  return false
}

export function completeness(cases: ReadonlyArray<KpiCase>, now: Date): Completeness {
  const alive = live(cases)
  const row = (name: string, keep: (c: KpiCase) => boolean): IdRow => {
    const ids = alive.filter(keep).map((c) => c.id)
    return { name, value: ids.length, ids }
  }
  const twelveHours = 12 * 3_600_000
  return {
    noReason: row('No delay reason recorded', (c) => c.stageNames.length === 0),
    openQuiet12h: row('Open, no update for 12 h', (c) => {
      if (c.status !== 'OPEN') return false
      const since = c.lastUpdateAt ?? c.registrationAt
      return now.getTime() - since.getTime() >= twelveHours
    }),
    resolvedNoDisposition: row('Resolved without a disposition', (c) => c.status === 'RESOLVED' && !c.disposition),
    outOfOrder: row('Times out of order', isOutOfOrder),
  }
}

export function repeatVisits(cases: ReadonlyArray<KpiCase>): Array<{ mrn: string; ids: string[] }> {
  const m = new Map<string, string[]>()
  for (const c of live(cases)) (m.get(c.mrn) ?? m.set(c.mrn, []).get(c.mrn)!).push(c.id)
  return [...m.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([mrn, ids]) => ({ mrn, ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.mrn.localeCompare(b.mrn))
}

// --- the per-case time sequence --------------------------------------------------------------

export type TimelineStep = { key: string; label: string; at: Date; fromPrevious: number | null }

const CONSULT_STEP_LABELS: Record<(typeof CONSULT_STEPS)[number][0], string> = {
  consultedAt: 'consulted',
  seenAt: 'seen patient',
  repliedAt: 'replied / plan given',
}

/**
 * Every recorded instant on the case in time order, with the hours since the previous one: the
 * deck's per-case slide, generated. Ties keep insertion order (registration, milestones,
 * investigations, consults, admission, transfer, escalation), so two steps at the same minute
 * read in the order the pathway happens.
 */
export function timeline(c: KpiCase): TimelineStep[] {
  const steps: Array<{ key: string; label: string; at: Date }> = []
  const push = (key: string, label: string, at: Date | null | undefined) => {
    if (at) steps.push({ key, label, at })
  }
  push('registrationAt', 'Registration', c.registrationAt)
  const milestone: Record<(typeof MILESTONES)[number][0], Date | null | undefined> = {
    triageAt: c.triageAt,
    roomAt: c.roomAt,
    physicianAt: c.physicianAt,
    decisionAt: c.decisionAt,
    departedAt: c.departedAt,
  }
  for (const [field, label] of MILESTONES) push(field, label, milestone[field])
  for (const i of c.investigations) {
    const prefix = INVESTIGATION_LABELS[i.type]
    const values: Record<string, Date | null> = {
      orderedAt: i.orderedAt,
      collectedAt: i.collectedAt,
      receivedAt: i.receivedAt,
      doneAt: i.doneAt,
      resultedAt: i.resultedAt,
    }
    for (const [field, label] of INVESTIGATION_STEPS[i.type]) {
      if (i.type !== 'LAB' && field === 'resultedAt') push(`${i.type}.preliminaryAt`, `${prefix}: preliminary report`, i.preliminaryAt)
      push(`${i.type}.${field}`, `${prefix}: ${label.toLowerCase()}`, values[field])
    }
  }
  for (const k of c.consults) {
    const values: Record<(typeof CONSULT_STEPS)[number][0], Date | null> = {
      consultedAt: k.consultedAt,
      seenAt: k.seenAt,
      repliedAt: k.repliedAt,
    }
    for (const [field] of CONSULT_STEPS) push(`consult.${k.departmentName}.${field}`, `${k.departmentName}: ${CONSULT_STEP_LABELS[field]}`, values[field])
  }
  const admission: Record<(typeof ADMISSION_STEPS)[number][0], Date | null> = {
    admOrderAt: c.admOrderAt,
    bedRequestedAt: c.bedRequestedAt,
    bedAssignedAt: c.bedAssignedAt,
    handoverAt: c.handoverAt,
  }
  for (const [field, label] of ADMISSION_STEPS) push(field, label, admission[field])
  const transfer: Record<(typeof TRANSFER_STEPS)[number][0], Date | null | undefined> = {
    transferRequestedAt: c.transferRequestedAt,
    transferAcceptedAt: c.transferAcceptedAt,
    transportArrivedAt: c.transportArrivedAt,
  }
  for (const [field, label] of TRANSFER_STEPS) push(field, label, transfer[field])
  push('medAdminInformedAt', 'Medical admin on-call informed', c.medAdminInformedAt)

  const ordered = steps
    .map((s, index) => ({ ...s, index }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.index - b.index)
  return ordered.map((s, i) => ({
    key: s.key,
    label: s.label,
    at: s.at,
    fromPrevious: i === 0 ? null : (s.at.getTime() - ordered[i - 1]!.at.getTime()) / 3_600_000,
  }))
}

// --- Adaa ------------------------------------------------------------------------------------

export type AdaaKpi = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4' | 'kpi5' | 'kpi6'
export type Benchmark = 'world' | 'acceptable' | 'improve' | 'unacceptable'

/**
 * The form's "ED KPIs Definitions" sheet. KPI 1–3 are minutes and lower is better; KPI 4 is a
 * share and lower is better; KPI 5 is a share and higher is better; KPI 6 has no benchmark.
 * Boundaries are read as the sheet writes them: "10-20 mins" is acceptable, so 20.0 is still
 * acceptable and 20.1 needs improvement.
 */
export const ADAA_BENCHMARKS: Record<Exclude<AdaaKpi, 'kpi6'>, { unit: 'minutes' | 'share'; world: number; acceptable: number; improve: number; higherIsBetter: boolean }> = {
  kpi1: { unit: 'minutes', world: 10, acceptable: 20, improve: 40, higherIsBetter: false },
  kpi2: { unit: 'minutes', world: 30, acceptable: 60, improve: 90, higherIsBetter: false },
  kpi3: { unit: 'minutes', world: 30, acceptable: 90, improve: 130, higherIsBetter: false },
  kpi4: { unit: 'share', world: 0.33, acceptable: 0.5, improve: 0.75, higherIsBetter: false },
  kpi5: { unit: 'share', world: 0.95, acceptable: 0.75, improve: 0.6, higherIsBetter: true },
}

export function benchmark(kpi: AdaaKpi, value: number): Benchmark | null {
  if (kpi === 'kpi6') return null
  const b = ADAA_BENCHMARKS[kpi]
  if (b.higherIsBetter) {
    if (value > b.world) return 'world'
    if (value >= b.acceptable) return 'acceptable'
    if (value >= b.improve) return 'improve'
    return 'unacceptable'
  }
  if (value < b.world) return 'world'
  if (value <= b.acceptable) return 'acceptable'
  if (value <= b.improve) return 'improve'
  return 'unacceptable'
}

/** KPI 1: door (registration or triage, whichever is earlier) to physician exam, minutes. */
export function kpi1Minutes(c: KpiCase): number | null {
  return minutesBetween(earliest(c.registrationAt, c.triageAt), c.physicianAt)
}

/** KPI 2: physician exam to decision, minutes. */
export function kpi2Minutes(c: KpiCase): number | null {
  return minutesBetween(c.physicianAt, c.decisionAt)
}

/** KPI 3: decision to disposition (left ED), minutes; resolved cases only. */
export function kpi3Minutes(c: KpiCase): number | null {
  return c.status === 'RESOLVED' ? minutesBetween(c.decisionAt, endAt(c)) : null
}

/** KPI 5's input: door to disposition in hours; resolved cases only. */
export function doorToDispositionHours(c: KpiCase): number | null {
  return c.status === 'RESOLVED' ? hoursBetween(c.registrationAt, endAt(c)) : null
}

/** The form's "treated within" columns AH–AN, as (min, max] hours with the first closed at 4. */
export const TREATED_BANDS: ReadonlyArray<Band> = [
  { name: 'Within 4 h', min: 0, max: 4 },
  { name: '4–6 h', min: 4, max: 6 },
  { name: '6–12 h', min: 6, max: 12 },
  { name: '12–24 h', min: 12, max: 24 },
  { name: '24–48 h', min: 24, max: 48 },
  { name: '48–72 h', min: 48, max: 72 },
  { name: '>72 h', min: 72, max: null },
]

/** Adaa counts "within 4 hours" as <= 4.0 exactly; every later band is (min, max]. */
function treatedBandIndex(hours: number): number {
  for (let i = 0; i < TREATED_BANDS.length; i += 1) {
    const b = TREATED_BANDS[i]!
    if (b.max == null || hours <= b.max) return i
  }
  return TREATED_BANDS.length - 1
}

export function treatedBands(cases: ReadonlyArray<KpiCase>): IdRow[] {
  const rows: IdRow[] = TREATED_BANDS.map((b) => ({ name: b.name, value: 0, ids: [] }))
  for (const c of live(cases)) {
    const h = doorToDispositionHours(c)
    if (h == null) continue
    const row = rows[treatedBandIndex(h)]!
    row.value += 1
    row.ids.push(c.id)
  }
  return rows
}

export type AdaaCtasKey = 1 | 2 | 3 | 4 | 5 | 'unknown' | 'overall'

export type AdaaSummaryRow = {
  ctas: AdaaCtasKey
  total: number
  ids: string[]
  kpi1TotalMin: number | null
  kpi1N: number
  kpi1Med: number | null
  kpi2TotalMin: number | null
  kpi2N: number
  kpi2Med: number | null
  kpi3TotalMin: number | null
  kpi3N: number
  kpi3Med: number | null
  /** One count per TREATED_BANDS entry. */
  treated: number[]
  treatedN: number
  withinFourShare: number | null
  damaShare: number | null
  resolvedN: number
  /** Only on the 'overall' row: CTAS 4–5 among cases with a CTAS. */
  nonUrgentShare: number | null
  withCtasN: number
}

function summaryRow(ctas: AdaaCtasKey, cases: ReadonlyArray<KpiCase>, all: ReadonlyArray<KpiCase>): AdaaSummaryRow {
  const stat = (f: (c: KpiCase) => number | null): { total: number | null; n: number; med: number | null } => {
    const xs = cases.map(f).filter((v): v is number => v != null)
    return { total: xs.length > 0 ? xs.reduce((a, b) => a + b, 0) : null, n: xs.length, med: guardedMedian(xs) }
  }
  const k1 = stat(kpi1Minutes)
  const k2 = stat(kpi2Minutes)
  const k3 = stat(kpi3Minutes)
  const treatedRows = treatedBands(cases)
  const treatedN = treatedRows.reduce((n, r) => n + r.value, 0)
  const resolved = cases.filter((c) => c.status === 'RESOLVED')
  const dama = resolved.filter((c) => c.disposition === 'DISCHARGED_DAMA').length
  const withCtas = all.filter((c) => c.ctas != null)
  const nonUrgent = withCtas.filter((c) => c.ctas === 4 || c.ctas === 5).length
  return {
    ctas,
    total: cases.length,
    ids: cases.map((c) => c.id),
    kpi1TotalMin: k1.total,
    kpi1N: k1.n,
    kpi1Med: k1.med,
    kpi2TotalMin: k2.total,
    kpi2N: k2.n,
    kpi2Med: k2.med,
    kpi3TotalMin: k3.total,
    kpi3N: k3.n,
    kpi3Med: k3.med,
    treated: treatedRows.map((r) => r.value),
    treatedN,
    withinFourShare: share(treatedRows[0]!.value, treatedN),
    damaShare: share(dama, resolved.length),
    resolvedN: resolved.length,
    nonUrgentShare: ctas === 'overall' ? share(nonUrgent, withCtas.length) : null,
    withCtasN: ctas === 'overall' ? withCtas.length : 0,
  }
}

/** One row per CTAS level present, an 'unknown' row when some cases have none, then 'overall'. */
export function adaaSummary(cases: ReadonlyArray<KpiCase>): AdaaSummaryRow[] {
  const alive = live(cases)
  const rows: AdaaSummaryRow[] = []
  for (const level of [1, 2, 3, 4, 5] as const) rows.push(summaryRow(level, alive.filter((c) => c.ctas === level), alive))
  const unknown = alive.filter((c) => c.ctas == null)
  if (unknown.length > 0) rows.push(summaryRow('unknown', unknown, alive))
  rows.push(summaryRow('overall', alive, alive))
  return rows
}

// --- admission to unit -----------------------------------------------------------------------

export const UNIT_TYPES = ['ICU', 'Ward'] as const
export type UnitType = (typeof UNIT_TYPES)[number]

const ICU_TYPE_CODES = new Set(['ICU', 'AICU', 'MICU', 'SICU', 'CCU', 'PICU', 'NICU'])

/** Adaa's AICU / PICU / NICU are one "critical" column here; everything else with a ward is Ward. */
export function unitTypeOf(wardCode: string | null | undefined): UnitType | null {
  if (!wardCode) return null
  const code = wardCode.trim().toUpperCase().split(/[\s/]/)[0] ?? ''
  return ICU_TYPE_CODES.has(code) ? 'ICU' : 'Ward'
}

/** The form's "Admission to" block: admission order to leaving the ED. */
export const ADMISSION_BANDS: ReadonlyArray<Band> = [
  { name: '≤30 min', min: 0, max: 0.5 + 1e-9 },
  { name: '≤1 h', min: 0.5 + 1e-9, max: 1 + 1e-9 },
  { name: '1–4 h', min: 1 + 1e-9, max: 4 + 1e-9 },
  { name: '>4 h', min: 4 + 1e-9, max: null },
]

export function admissionToUnitBands(cases: ReadonlyArray<KpiCase>): Array<{ unit: UnitType; bands: IdRow[] }> {
  const values: Record<UnitType, Array<{ id: string; v: number }>> = { ICU: [], Ward: [] }
  for (const c of live(cases)) {
    const unit = unitTypeOf(c.wardCode)
    const h = hoursBetween(c.admOrderAt, c.departedAt ?? c.handoverAt)
    if (!unit || h == null) continue
    values[unit].push({ id: c.id, v: h })
  }
  return UNIT_TYPES.map((unit) => ({ unit, bands: bandRows(ADMISSION_BANDS, values[unit]) }))
}

// --- the August sheet's working targets -----------------------------------------------------

export const TARGETS = [
  { key: 'lab60', name: 'Lab resulted within 1 h of order', minutes: 60 },
  { key: 'imaging90', name: 'Imaging reported within 90 min of order', minutes: 90 },
  { key: 'consult60', name: 'Consulted team responded within 1 h', minutes: 60 },
  { key: 'decision150', name: 'Decision within 2 h 30 of physician contact', minutes: 150 },
  { key: 'toWard30', name: 'Left ED within 30 min of admission order', minutes: 30 },
] as const

export type TargetKey = (typeof TARGETS)[number]['key']

type Unit = { caseId: string; minutes: number }

function unitsFor(key: TargetKey, c: KpiCase): Unit[] {
  const one = (m: number | null): Unit[] => (m == null ? [] : [{ caseId: c.id, minutes: m }])
  switch (key) {
    case 'lab60':
      return c.investigations.filter((i) => i.type === 'LAB').flatMap((i) => one(minutesBetween(i.orderedAt, i.resultedAt)))
    case 'imaging90':
      return c.investigations
        .filter((i) => i.type !== 'LAB')
        .flatMap((i) => one(minutesBetween(i.orderedAt, earliest(i.preliminaryAt, i.resultedAt))))
    case 'consult60':
      return c.consults.flatMap((k) => one(minutesBetween(k.consultedAt, earliest(k.seenAt, k.repliedAt))))
    case 'decision150':
      return one(kpi2Minutes(c))
    case 'toWard30':
      return one(minutesBetween(c.admOrderAt, c.departedAt ?? c.handoverAt))
  }
}

/**
 * One row per target. The unit of analysis is the investigation row, the consult row or the
 * case as the target implies; `n` and `within` count units, `ids` the cases that have any unit,
 * `withinIds` the cases whose every unit met the target. The drill-down for "missed" is
 * `ids` minus `withinIds`.
 */
export function targets(cases: ReadonlyArray<KpiCase>): ShareRow[] {
  const alive = live(cases)
  return TARGETS.map((t) => {
    let n = 0
    let within = 0
    const ids: string[] = []
    const withinIds: string[] = []
    for (const c of alive) {
      const units = unitsFor(t.key, c)
      if (units.length === 0) continue
      ids.push(c.id)
      n += units.length
      const met = units.filter((u) => u.minutes <= t.minutes).length
      within += met
      if (met === units.length) withinIds.push(c.id)
    }
    return { name: t.name, n, within, ids, withinIds, share: share(within, n) }
  })
}

/** First physician contact to the consult request, by department (the March deck's slide 9). */
export function examToConsult(cases: ReadonlyArray<KpiCase>): StatRow[] {
  const m = new Map<string, { ids: string[]; hours: number[] }>()
  for (const c of live(cases)) {
    for (const k of c.consults) {
      const h = hoursBetween(c.physicianAt, k.consultedAt)
      if (h == null) continue
      const row = m.get(k.departmentName) ?? m.set(k.departmentName, { ids: [], hours: [] }).get(k.departmentName)!
      row.ids.push(c.id)
      row.hours.push(h)
    }
  }
  return [...m.entries()]
    .map(([name, { ids, hours }]) => ({ name, n: hours.length, ids: unique(ids), med: guardedMedian(hours) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

export const TURNAROUND_BANDS: ReadonlyArray<Band> = [
  { name: '≤30 min', min: 0, max: 30 + 1e-9 },
  { name: '31–60 min', min: 30 + 1e-9, max: 60 + 1e-9 },
  { name: '61–90 min', min: 60 + 1e-9, max: 90 + 1e-9 },
  { name: '91–120 min', min: 90 + 1e-9, max: 120 + 1e-9 },
  { name: '2–4 h', min: 120 + 1e-9, max: 240 + 1e-9 },
  { name: '>4 h', min: 240 + 1e-9, max: null },
]

export type TurnaroundRow = { type: KpiInvestigationType; orderToResult: IdRow[]; doneToReport: IdRow[] }

/**
 * Order to result (imaging: the earlier of the preliminary and the official report) and the
 * second leg (imaging: scan done to report; lab: received by lab to resulted), in minute bands.
 */
export function turnaroundBands(cases: ReadonlyArray<KpiCase>): TurnaroundRow[] {
  const types: KpiInvestigationType[] = ['LAB', 'CT', 'US', 'XR']
  const alive = live(cases)
  return types.map((type) => {
    const first: Array<{ id: string; v: number }> = []
    const second: Array<{ id: string; v: number }> = []
    for (const c of alive) {
      for (const i of c.investigations) {
        if (i.type !== type) continue
        const report = type === 'LAB' ? i.resultedAt : earliest(i.preliminaryAt, i.resultedAt)
        const a = minutesBetween(i.orderedAt, report)
        if (a != null) first.push({ id: c.id, v: a })
        const b = type === 'LAB' ? minutesBetween(i.receivedAt, i.resultedAt) : minutesBetween(i.doneAt, report)
        if (b != null) second.push({ id: c.id, v: b })
      }
    }
    return { type, orderToResult: bandRows(TURNAROUND_BANDS, first), doneToReport: bandRows(TURNAROUND_BANDS, second) }
  })
}

// --- by CTAS, by area ------------------------------------------------------------------------

export const NOT_RECORDED = 'Not recorded'

function statBy(cases: ReadonlyArray<KpiCase>, now: Date, keyOf: (c: KpiCase) => string): StatRow[] {
  const m = new Map<string, { ids: string[]; hours: number[] }>()
  for (const { c, v } of stayValues(cases, now)) {
    const key = keyOf(c)
    const row = m.get(key) ?? m.set(key, { ids: [], hours: [] }).get(key)!
    row.ids.push(c.id)
    row.hours.push(v)
  }
  return [...m.entries()].map(([name, { ids, hours }]) => ({ name, n: ids.length, ids, med: guardedMedian(hours) }))
}

/** '1'..'5' in order, then 'Not recorded' last when any case lacks a CTAS. */
export function byCtas(cases: ReadonlyArray<KpiCase>, now: Date): StatRow[] {
  const rows = statBy(cases, now, (c) => (c.ctas == null ? NOT_RECORDED : String(c.ctas)))
  return rows.sort((a, b) => {
    if (a.name === NOT_RECORDED) return 1
    if (b.name === NOT_RECORDED) return -1
    return a.name.localeCompare(b.name)
  })
}

/** Largest first, 'Not recorded' last. */
export function byArea(cases: ReadonlyArray<KpiCase>, now: Date): StatRow[] {
  const rows = statBy(cases, now, (c) => c.areaName ?? NOT_RECORDED)
  return rows.sort((a, b) => {
    if (a.name === NOT_RECORDED) return 1
    if (b.name === NOT_RECORDED) return -1
    return b.n - a.n || a.name.localeCompare(b.name)
  })
}
