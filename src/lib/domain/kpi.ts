/**
 * The Phase 8 numbers: what the weekly delayed-tickets deck, the monthly ER Journey deck and the
 * Adaa ED KPI form compute, over the cases this app tracks (`docs/specs/phase8-brief.md`).
 *
 * Pure functions over `KpiCase`, a structural subset of the dashboard's `CaseForStats`. Nothing
 * here renders, loads or rounds for display; every median honours `MIN_N` and comes back null
 * below it, and every count row carries the case ids for a drill-down. Every duration is
 * end minus start and is null when either end is missing or the order is impossible (a result
 * before its order), so a typo never becomes a negative KPI.
 *
 * Three definitions used throughout, so that every figure agrees with every other:
 *  - the DOOR is the earlier of registration and triage (the Adaa definitions sheet defines it
 *    once, for KPI 1 and KPI 5 alike);
 *  - LEAVING the ED is `endAt()` from time.ts: departed, else resolved, and only for a RESOLVED
 *    case, so a reopened case (which keeps its old departure time) is open again everywhere;
 *  - a VOIDED case is in no figure at all.
 *
 * Verified 2026-09-09 by three independent recomputations of the fixture and an adjudication
 * (workflow `ern-kpi-verify`); the rulings are in the comments where they apply.
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

export type KpiInvestigationType = 'LAB' | 'CT' | 'US' | 'XR' | 'MRI'

export type Answer = 'YES' | 'NO' | 'NOT_SURE'
export type Payer = 'GOVERNMENT' | 'INSURED' | 'SELF_PAY'

/** The weekly deck's operational-response categories, as recorded on an update (decision C). */
export type UpdateActionKind =
  | 'LEADERSHIP_ESCALATION'
  | 'BED_MANAGEMENT'
  | 'FAX_RCC'
  | 'PRO_SOCIAL_WORK'
  | 'FORCED_SAFETY_ADMISSION'
  | 'DAMA_MANAGEMENT'

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
  roomAt: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
  handoverAt: Date | null
  transferRequestedAt: Date | null
  transferAcceptedAt: Date | null
  transportArrivedAt: Date | null
  medAdminInformedAt: Date | null
  disposition: string | null
  wardCode: string | null
  ctas: number | null
  areaName: string | null
  /** Phase 10: who pays for the visit. */
  payer: Payer | null
  stageNames: ReadonlyArray<string>
  /** The same stages by code, in stage order (Phase 10: the phase split reads these). */
  stageCodes: ReadonlyArray<string>
  updatesCount: number
  lastUpdateAt: Date | null
  consults: ReadonlyArray<KpiConsult>
  investigations: ReadonlyArray<KpiInvestigation>
  // Phase 8b (decisions B, C, D, F, H)
  painkillerPrescribed: Answer | null
  pethidinePrescribed: Answer | null
  pethidineDoseMg: number | null
  painkillerAt: Date | null
  sickleCellTreatment: Answer | null
  instructionsGiven: Answer | null
  familyEngagement: Answer | null
  caseMgmtReferral: 'CASE_MANAGER' | 'COMPLEX_CARE' | null
  caseMgmtCriteria: 'MEETS' | 'NOT_MEETING' | null
  caseMgmtAction: 'ENROLLED' | 'FOR_ENROLLMENT' | null
  caseMgmtCalledAt: Date | null
  caseMgmtRepliedAt: Date | null
  reviewedAt: Date | null
  reviewedByName: string | null
  /** The distinct action kinds recorded on the case's updates. */
  updateActions: ReadonlyArray<UpdateActionKind>
  /**
   * Updates a navigator wrote with no action tag (the loader counts them; distinct kinds cannot).
   * The app's own resolve, reopen, void and alert notes are not counted (Phase 8b review C2).
   */
  untaggedUpdatesCount: number
}

/** A count with a drill-down. `ids` are case ids, deduplicated; `value` may exceed `ids.length` where the unit is a row, and the function says so. */
export type IdRow = { name: string; value: number; ids: string[] }
/** `share` = within / n, null when n < MIN_N. `ids` are the cases with any unit, `withinIds` those whose every unit met the target. */
export type ShareRow = { name: string; n: number; within: number; ids: string[]; withinIds: string[]; share: number | null }
/** `n` is the unit of analysis (cases, or consults where the function says so); `ids` the cases behind it; `med` in hours, null below MIN_N. */
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

/** The Adaa door: registration or triage, whichever is earlier. Used by KPI 1 and KPI 5 alike. */
export function doorAt(c: KpiCase): Date {
  return earliest(c.registrationAt, c.triageAt) ?? c.registrationAt
}

/** When the patient left the ED, for a resolved case: departed, else resolved. Open: null. */
export function leftAt(c: KpiCase): Date | null {
  return endAt(c)
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

export type BandDef = { name: string; min: number; max: number | null }

/** Half-open bands [min, max); `max: null` is open-ended. A zero-width first band never matches. */
function bandRows(bands: ReadonlyArray<BandDef>, values: ReadonlyArray<{ id: string; v: number }>): IdRow[] {
  return bands.map((b) => {
    const hits = values.filter(({ v }) => v >= b.min && (b.max == null || v < b.max))
    return { name: b.name, value: hits.length, ids: unique(hits.map(({ id }) => id)) }
  })
}

// --- the weekly deck -------------------------------------------------------------------------

export const STAY_BANDS: ReadonlyArray<BandDef> = [
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

/** One case per band; a case whose stay cannot be computed (leaving before registration) is in none. */
export function stayBands(cases: ReadonlyArray<KpiCase>, now: Date): IdRow[] {
  return bandRows(STAY_BANDS, stayValues(cases, now))
}

export type Headline = {
  /** Live cases in the range. */
  cases: number
  /** Of those, the ones with a computable stay: what every stay-based figure below counts. */
  measured: number
  episodes: number
  /** Median and mean: null below MIN_N. Min and max are facts, shown whenever there is one. */
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
  const longest = values.reduce<(typeof values)[number] | null>((best, x) => (best == null || x.v > best.v ? x : best), null)
  return {
    cases: alive.length,
    measured: values.length,
    episodes: new Set(alive.map((c) => c.mrn)).size,
    med: guardedMedian(hours),
    mean: hours.length >= MIN_N ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    min: hours.length > 0 ? Math.min(...hours) : null,
    max: hours.length > 0 ? Math.max(...hours) : null,
    atLeast10: hours.filter((h) => h >= 10).length,
    atLeast12: hours.filter((h) => h >= 12).length,
    longest: longest ? { id: longest.id, mrn: longest.mrn, hours: longest.v } : null,
  }
}

export type KpiRange = '7' | '30' | '90' | 'all'

/**
 * The period of the same length immediately before `inRange`'s window (registration within the
 * last N days of `now`): registrations older than N days and at most 2N days old, together with
 * `asOf`, the instant that window ended. Compute the previous period's headline with
 * `headline(cases, asOf)`, never with `now`: a case still open then must be measured to the end
 * of its own period, not to today. Empty for 'all', which has no "before".
 */
export function previousRange(all: ReadonlyArray<KpiCase>, range: KpiRange, now: Date): { cases: KpiCase[]; asOf: Date } {
  if (range === 'all') return { cases: [], asOf: now }
  const ms = Number(range) * 864e5
  const asOf = new Date(now.getTime() - ms)
  const cases = live(all).filter((c) => {
    const age = now.getTime() - c.registrationAt.getTime()
    return age > ms && age <= 2 * ms
  })
  return { cases, asOf }
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

/**
 * The weekly deck's six operational-response categories, plus a row for updates written without
 * a tag. An action is documented either as a tagged update (decision C) or by the timestamp the
 * app already records for it: an escalation to medical admin is a leadership escalation, a bed
 * request (fax) is bed management, a transfer request is the transfer / fax / RCC pathway.
 */
export const ACTION_KINDS = [
  ['LEADERSHIP_ESCALATION', 'Leadership escalation'],
  ['BED_MANAGEMENT', 'Case / bed management'],
  ['FAX_RCC', 'External transfer / fax / RCC'],
  ['PRO_SOCIAL_WORK', 'PRO / social work'],
  ['FORCED_SAFETY_ADMISSION', 'Forced / safety admission'],
  ['DAMA_MANAGEMENT', 'DAMA management'],
  ['UNTAGGED', 'Update without an action tag'],
] as const

export type ActionKind = (typeof ACTION_KINDS)[number][0]

export type Actions = { any: IdRow; none: IdRow; byKind: IdRow[] }

function actionKindsOf(c: KpiCase): ActionKind[] {
  const kinds = new Set<ActionKind>(c.updateActions ?? [])
  if (c.medAdminInformedAt) kinds.add('LEADERSHIP_ESCALATION')
  if (c.bedRequestedAt) kinds.add('BED_MANAGEMENT')
  if (c.transferRequestedAt) kinds.add('FAX_RCC')
  // Text written with no category chosen. A count, not a comparison against the distinct kinds:
  // two updates both tagged "bed management" are two tagged updates, not one (verification 8b).
  if ((c.untaggedUpdatesCount ?? 0) > 0) kinds.add('UNTAGGED')
  return [...kinds]
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

/**
 * Decision E's two dispositions, named here as well as in the taxonomy so this module reads the
 * same whether or not the taxonomy of the checkout has caught up (Slice G adds them there).
 */
const DISPOSITION_FALLBACK_LABELS: Record<string, string> = { DECEASED: 'Deceased', REFERRED_UCC: 'Referred to UCC' }

export function dispositionLabel(disposition: string): string {
  return (DISPOSITION_LABELS as Record<string, string>)[disposition] ?? DISPOSITION_FALLBACK_LABELS[disposition] ?? disposition
}

/** Resolved cases by disposition (largest first), then the open ones as one row. */
export function outcomes(cases: ReadonlyArray<KpiCase>): IdRow[] {
  const alive = live(cases)
  const m = new Map<string, string[]>()
  for (const c of alive) {
    if (c.status !== 'RESOLVED') continue
    const label = c.disposition ? dispositionLabel(c.disposition) : 'Not recorded'
    ;(m.get(label) ?? m.set(label, []).get(label)!).push(c.id)
  }
  const rows = [...m.entries()]
    .map(([name, ids]) => ({ name, value: ids.length, ids }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  const open = alive.filter((c) => c.status === 'OPEN').map((c) => c.id)
  if (open.length > 0) rows.push({ name: STILL_OPEN, value: open.length, ids: open })
  return rows
}

export type Completeness = {
  noReason: IdRow
  openQuiet12h: IdRow
  /** Open for 24 h with no disposition decision recorded (the brief's "no disposition after 24 h"). */
  noDecision24h: IdRow
  resolvedNoDisposition: IdRow
  outOfOrder: IdRow
  /** No computable stay: a leaving time before the registration (validation refuses a future registration, so this is the case that reaches the database); the case is in no stay-based figure. */
  noStay: IdRow
  /** Resolved and not yet marked reviewed by a supervisor (decision H). */
  resolvedNotReviewed: IdRow
  /** Painkiller recorded as prescribed with no time given: in no KPI 8 figure until the time is entered. */
  painkillerNoTime: IdRow
  /** Pethidine recorded as prescribed with no dose, or a dose outside 50 / 100 / 150 mg. */
  pethidineNoDose: IdRow
}

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
  if (!inOrder([c.registrationAt, c.triageAt, c.roomAt, c.physicianAt, c.decisionAt, leftAt(c)])) return true
  if (!inOrder([c.admOrderAt, c.bedRequestedAt, c.bedAssignedAt, c.handoverAt])) return true
  if (!inOrder([c.transferRequestedAt, c.transferAcceptedAt, c.transportArrivedAt])) return true
  if (!inOrder([c.caseMgmtCalledAt, c.caseMgmtRepliedAt])) return true
  if (!inOrder([c.registrationAt, c.painkillerAt])) return true
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
  const hours = (h: number) => h * 3_600_000
  return {
    noReason: row('No delay reason recorded', (c) => c.stageNames.length === 0),
    openQuiet12h: row('Open, no update for 12 h', (c) => {
      if (c.status !== 'OPEN') return false
      const since = c.lastUpdateAt ?? c.registrationAt
      return now.getTime() - since.getTime() >= hours(12)
    }),
    noDecision24h: row('Open 24 h with no disposition decided', (c) => c.status === 'OPEN' && !c.decisionAt && now.getTime() - c.registrationAt.getTime() >= hours(24)),
    resolvedNoDisposition: row('Resolved without a disposition', (c) => c.status === 'RESOLVED' && !c.disposition),
    outOfOrder: row('Times out of order', isOutOfOrder),
    noStay: row('Stay cannot be computed (leaving before registration)', (c) => elapsedHours(c, now) == null),
    resolvedNotReviewed: row('Resolved, not yet reviewed', (c) => c.status === 'RESOLVED' && !c.reviewedAt),
    painkillerNoTime: row('Painkiller prescribed, no time given recorded', (c) => c.painkillerPrescribed === 'YES' && !c.painkillerAt),
    pethidineNoDose: row(
      'Pethidine prescribed, dose missing or not 50 / 100 / 150 mg',
      (c) => c.pethidinePrescribed === 'YES' && !(PETHIDINE_DOSES_MG as ReadonlyArray<number>).includes(c.pethidineDoseMg ?? -1),
    ),
  }
}

/**
 * Decision D: the two discharge-communication answers as shares of the cases that answered
 * (YES, NO or NOT_SURE); `within` counts YES. A case with no answer is not in `n`.
 */
export function communication(cases: ReadonlyArray<KpiCase>): ShareRow[] {
  const alive = live(cases)
  const one = (name: string, pick: (c: KpiCase) => Answer | null): ShareRow => {
    const answered = alive.filter((c) => pick(c) != null)
    const yes = answered.filter((c) => pick(c) === 'YES')
    return {
      name,
      n: answered.length,
      within: yes.length,
      ids: answered.map((c) => c.id),
      withinIds: yes.map((c) => c.id),
      share: share(yes.length, answered.length),
    }
  }
  return [one('Instructions given by doctor', (c) => c.instructionsGiven), one('Family engaged', (c) => c.familyEngagement)]
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

const INVESTIGATION_ORDER: Record<KpiInvestigationType, number> = { LAB: 0, CT: 1, US: 2, XR: 3, MRI: 4 }

type StepTable = ReadonlyArray<readonly [string, string]>

/** MRI (decision G) follows the CT steps; named here too so the module stands before the taxonomy has it. */
const MRI_STEPS: StepTable = [
  ['orderedAt', 'Ordered'],
  ['doneAt', 'Scan done'],
  ['preliminaryAt', 'Preliminary report'],
  ['resultedAt', 'Reported'],
]

function investigationLabel(type: KpiInvestigationType): string {
  return (INVESTIGATION_LABELS as Record<string, string>)[type] ?? 'MRI'
}

function investigationSteps(type: KpiInvestigationType): StepTable {
  return (INVESTIGATION_STEPS as Record<string, StepTable>)[type] ?? MRI_STEPS
}

/**
 * Every recorded instant on the case in time order, with the hours since the previous one: the
 * deck's per-case slide, generated. Ties are broken by a fixed pathway order that does not
 * depend on how the rows were loaded: registration, milestones, investigations (lab, CT,
 * ultrasound, X-ray, and within a type in the order given), consults (by department name),
 * the admission chain, the transfer chain, the escalation, and "Resolved" when a resolved case
 * has no departure time. Keys are unique even with two rows of one type or two consults to one
 * department.
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
  const investigations = [...c.investigations].sort((a, b) => INVESTIGATION_ORDER[a.type] - INVESTIGATION_ORDER[b.type])
  investigations.forEach((i, index) => {
    const prefix = investigationLabel(i.type)
    const values: Record<string, Date | null> = {
      orderedAt: i.orderedAt,
      collectedAt: i.collectedAt,
      receivedAt: i.receivedAt,
      doneAt: i.doneAt,
      preliminaryAt: i.preliminaryAt,
      resultedAt: i.resultedAt,
    }
    for (const [field, label] of investigationSteps(i.type)) {
      push(`investigation.${index}.${field}`, `${prefix}: ${label.toLowerCase()}`, values[field])
    }
  })
  const consults = [...c.consults].sort((a, b) => a.departmentName.localeCompare(b.departmentName))
  consults.forEach((k, index) => {
    const values: Record<(typeof CONSULT_STEPS)[number][0], Date | null> = {
      consultedAt: k.consultedAt,
      seenAt: k.seenAt,
      repliedAt: k.repliedAt,
    }
    for (const [field] of CONSULT_STEPS) push(`consult.${index}.${field}`, `${k.departmentName}: ${CONSULT_STEP_LABELS[field]}`, values[field])
  })
  const admission: Record<(typeof ADMISSION_STEPS)[number][0], Date | null> = {
    admOrderAt: c.admOrderAt,
    bedRequestedAt: c.bedRequestedAt,
    bedAssignedAt: c.bedAssignedAt,
    handoverAt: c.handoverAt,
  }
  for (const [field, label] of ADMISSION_STEPS) push(field, label, admission[field])
  const transfer: Record<(typeof TRANSFER_STEPS)[number][0], Date | null> = {
    transferRequestedAt: c.transferRequestedAt,
    transferAcceptedAt: c.transferAcceptedAt,
    transportArrivedAt: c.transportArrivedAt,
  }
  for (const [field, label] of TRANSFER_STEPS) push(field, label, transfer[field])
  push('medAdminInformedAt', 'Medical admin on-call informed', c.medAdminInformedAt)
  push('painkillerAt', 'Painkiller given', c.painkillerAt)
  push('caseMgmtCalledAt', 'Case management called', c.caseMgmtCalledAt)
  push('caseMgmtRepliedAt', 'Case management replied', c.caseMgmtRepliedAt)
  if (c.status === 'RESOLVED' && !c.departedAt) push('resolvedAt', 'Resolved (no departure time recorded)', c.resolvedAt)

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

export type AdaaKpi = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4' | 'kpi5' | 'kpi6' | 'kpi7' | 'kpi8'
export type Benchmark = 'world' | 'acceptable' | 'improve' | 'unacceptable'

/**
 * The form's "ED KPIs Definitions" sheet. KPI 1–3 and 8 are minutes and lower is better; KPI 4
 * is a share and lower is better; KPI 5 is a share and higher is better; KPI 6 and 7 have no
 * benchmark and are `null` here, as `benchmark()` returns for them. Boundaries are read as the
 * sheet writes them: "10-20 mins" is acceptable, so 20.0 is still acceptable and 20.1 needs
 * improvement; KPI 8 "less than 1 hour" is world class, "1 hour to 3 hours" acceptable, "3 to
 * 5 hours" needs improvement, "more than 5 hours" unacceptable.
 */
export const ADAA_BENCHMARKS: Record<AdaaKpi, { unit: 'minutes' | 'share'; world: number; acceptable: number; improve: number; higherIsBetter: boolean } | null> = {
  kpi1: { unit: 'minutes', world: 10, acceptable: 20, improve: 40, higherIsBetter: false },
  kpi2: { unit: 'minutes', world: 30, acceptable: 60, improve: 90, higherIsBetter: false },
  kpi3: { unit: 'minutes', world: 30, acceptable: 90, improve: 130, higherIsBetter: false },
  kpi4: { unit: 'share', world: 0.33, acceptable: 0.5, improve: 0.75, higherIsBetter: false },
  kpi5: { unit: 'share', world: 0.95, acceptable: 0.75, improve: 0.6, higherIsBetter: true },
  kpi6: null,
  kpi7: null,
  kpi8: { unit: 'minutes', world: 60, acceptable: 180, improve: 300, higherIsBetter: false },
}

export function benchmark(kpi: AdaaKpi, value: number): Benchmark | null {
  const b = ADAA_BENCHMARKS[kpi]
  if (!b) return null
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

/** KPI 1: door to physician exam, minutes. */
export function kpi1Minutes(c: KpiCase): number | null {
  return minutesBetween(doorAt(c), c.physicianAt)
}

/** KPI 2: physician exam to decision, minutes. */
export function kpi2Minutes(c: KpiCase): number | null {
  return minutesBetween(c.physicianAt, c.decisionAt)
}

/** KPI 3: decision to leaving the ED, minutes; resolved cases only. */
export function kpi3Minutes(c: KpiCase): number | null {
  return minutesBetween(c.decisionAt, leftAt(c))
}

/** KPI 5's input: door to leaving the ED in hours; resolved cases only. */
export function doorToDispositionHours(c: KpiCase): number | null {
  return hoursBetween(doorAt(c), leftAt(c))
}

/** KPI 8: door to the painkiller being given, minutes; only when one was prescribed (decision F). */
export function kpi8Minutes(c: KpiCase): number | null {
  if (c.painkillerPrescribed !== 'YES') return null
  return minutesBetween(doorAt(c), c.painkillerAt)
}

/** The form's "Pain Killer Statistics" block: (min, max] minutes, the first closed at 30. */
export const PAINKILLER_BANDS: ReadonlyArray<BandDef> = [
  { name: '≤30 min', min: 0, max: 30 + 1e-9 },
  { name: '>30 min–1 h', min: 30 + 1e-9, max: 60 + 1e-9 },
  { name: '>1–3 h', min: 60 + 1e-9, max: 180 + 1e-9 },
  { name: '>3 h', min: 180 + 1e-9, max: null },
]

export function painkillerBands(cases: ReadonlyArray<KpiCase>): IdRow[] {
  const values: Array<{ id: string; v: number }> = []
  for (const c of live(cases)) {
    const m = kpi8Minutes(c)
    if (m != null) values.push({ id: c.id, v: m })
  }
  return bandRows(PAINKILLER_BANDS, values)
}

export const PETHIDINE_DOSES_MG = [50, 100, 150] as const

/** Pethidine prescriptions by dose, among the cases where it was prescribed. */
export function pethidineDoses(cases: ReadonlyArray<KpiCase>): IdRow[] {
  const alive = live(cases).filter((c) => c.pethidinePrescribed === 'YES')
  return PETHIDINE_DOSES_MG.map((mg) => {
    const ids = alive.filter((c) => c.pethidineDoseMg === mg).map((c) => c.id)
    return { name: `${mg} mg`, value: ids.length, ids }
  })
}

/** The form's "treated within" columns AH–AN, as (min, max] hours with the first closed at 4. */
export const TREATED_BANDS: ReadonlyArray<BandDef> = [
  { name: 'Within 4 h', min: 0, max: 4 },
  { name: '4–6 h', min: 4, max: 6 },
  { name: '6–12 h', min: 6, max: 12 },
  { name: '12–24 h', min: 12, max: 24 },
  { name: '24–48 h', min: 24, max: 48 },
  { name: '48–72 h', min: 48, max: 72 },
  { name: '>72 h', min: 72, max: null },
]

/** Adaa counts "within 4 hours" as <= 4.0 exactly; every later band is (min, max]. */
export function treatedBandIndex(hours: number): number {
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
  /**
   * KPI 6 as the app can measure it: DAMA among resolved cases. The form defines KPI 6 as LAMA
   * or DAMA; LAMA is not a disposition here (brief, Section 5, decision E), so this is a lower
   * bound until it is. The Adaa export's Read me says so.
   */
  damaShare: number | null
  resolvedN: number
  /** Only on the 'overall' row: CTAS 4–5 among cases with a CTAS. */
  nonUrgentShare: number | null
  withCtasN: number
  /**
   * KPI 7 as the form defines it: deaths divided by TOTAL patients, here every tracked case in
   * the group, open ones included (the form's own denominator; a resolved-only rate would rise
   * and fall within a week as cases close). Decision E made Deceased a disposition. `deceasedN`
   * and `resolvedN` sit beside it for the drill-down and for anyone who wants the other rate.
   */
  deceasedShare: number | null
  deceasedN: number
  /** Referred to UCC among resolved cases (the form's "Total Number referred to UCC"). */
  uccN: number
  /** KPI 8: door to painkiller, minutes, among cases where one was prescribed and given. */
  kpi8TotalMin: number | null
  kpi8N: number
  kpi8Med: number | null
  /** One count per PAINKILLER_BANDS entry. */
  painkiller: number[]
  /** One count per PETHIDINE_DOSES_MG entry. */
  pethidine: number[]
  /** Cases recorded as painkiller prescribed / pethidine prescribed: the true denominators of the bands and doses above. */
  painkillerYesN: number
  pethidineYesN: number
  sickleCellYesN: number
}

function summaryRow(ctas: AdaaCtasKey, cases: ReadonlyArray<KpiCase>, all: ReadonlyArray<KpiCase>): AdaaSummaryRow {
  const stat = (f: (c: KpiCase) => number | null): { total: number | null; n: number; med: number | null } => {
    const xs = cases.map(f).filter((v): v is number => v != null)
    return { total: xs.length > 0 ? xs.reduce((a, b) => a + b, 0) : null, n: xs.length, med: guardedMedian(xs) }
  }
  const k1 = stat(kpi1Minutes)
  const k2 = stat(kpi2Minutes)
  const k3 = stat(kpi3Minutes)
  const k8 = stat(kpi8Minutes)
  const treatedRows = treatedBands(cases)
  const treatedN = treatedRows.reduce((n, r) => n + r.value, 0)
  const resolved = cases.filter((c) => c.status === 'RESOLVED')
  const dama = resolved.filter((c) => c.disposition === 'DISCHARGED_DAMA').length
  const deceased = resolved.filter((c) => c.disposition === 'DECEASED').length
  const ucc = resolved.filter((c) => c.disposition === 'REFERRED_UCC').length
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
    deceasedShare: share(deceased, cases.length),
    deceasedN: deceased,
    uccN: ucc,
    kpi8TotalMin: k8.total,
    kpi8N: k8.n,
    kpi8Med: k8.med,
    painkiller: painkillerBands(cases).map((r) => r.value),
    pethidine: pethidineDoses(cases).map((r) => r.value),
    painkillerYesN: cases.filter((c) => c.painkillerPrescribed === 'YES').length,
    pethidineYesN: cases.filter((c) => c.pethidinePrescribed === 'YES').length,
    sickleCellYesN: cases.filter((c) => c.sickleCellTreatment === 'YES').length,
  }
}

/** One row per CTAS level 1..5 (always), an 'unknown' row when some cases have none, then 'overall'. */
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

/**
 * The form's "Admission to" block: admission order to leaving the ED, hours. The form's own
 * "within 1 hour" column reaches 0.04208333 days, which is 1 h 0.6 min; this module stops at
 * 1.00 h exactly. A row within those 36 seconds lands one column later here than in the
 * official file; the Adaa export's Read me records the difference.
 */
export const ADMISSION_BANDS: ReadonlyArray<BandDef> = [
  { name: '≤30 min', min: 0, max: 0.5 + 1e-9 },
  { name: '≤1 h', min: 0.5 + 1e-9, max: 1 + 1e-9 },
  { name: '1–4 h', min: 1 + 1e-9, max: 4 + 1e-9 },
  { name: '>4 h', min: 4 + 1e-9, max: null },
]

/** Admission order to leaving the ED (or the nursing handover when the departure was not recorded). */
function orderToLeaveHours(c: KpiCase): number | null {
  return hoursBetween(c.admOrderAt, leftAt(c) ?? c.handoverAt)
}

export function admissionToUnitBands(cases: ReadonlyArray<KpiCase>): Array<{ unit: UnitType; bands: IdRow[] }> {
  const values: Record<UnitType, Array<{ id: string; v: number }>> = { ICU: [], Ward: [] }
  for (const c of live(cases)) {
    const unit = unitTypeOf(c.wardCode)
    const h = orderToLeaveHours(c)
    if (!unit || h == null) continue
    values[unit].push({ id: c.id, v: h })
  }
  return UNIT_TYPES.map((unit) => ({ unit, bands: bandRows(ADMISSION_BANDS, values[unit]) }))
}

// --- the August sheet's working targets -----------------------------------------------------

export const TARGETS = [
  { key: 'lab60', name: 'Lab resulted within 1 h of order', minutes: 60 },
  { key: 'imaging90', name: 'Imaging official report within 90 min of order', minutes: 90 },
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
      // The official report, as the brief defines the target; the preliminary read is a
      // turnaround figure (turnaroundBands), not a compliance one.
      return c.investigations.filter((i) => i.type !== 'LAB').flatMap((i) => one(minutesBetween(i.orderedAt, i.resultedAt)))
    case 'consult60':
      return c.consults.flatMap((k) => one(minutesBetween(k.consultedAt, earliest(k.seenAt, k.repliedAt))))
    case 'decision150':
      return one(kpi2Minutes(c))
    case 'toWard30': {
      const h = orderToLeaveHours(c)
      return one(h == null ? null : h * 60)
    }
  }
}

/**
 * One row per target. The unit of analysis is the investigation row, the consult row or the
 * case as the target implies; `n` and `within` count units, `ids` the cases that have any unit,
 * `withinIds` the cases whose every unit met the target. The drill-down for "missed" is
 * `ids` minus `withinIds`. "Within" is at or under the threshold.
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

/**
 * First physician contact to the consult request, by department (the March deck's slide 9).
 * `n` counts consults, not cases: a case consulting the same department twice contributes two.
 */
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

export const TURNAROUND_BANDS: ReadonlyArray<BandDef> = [
  { name: '≤30 min', min: 0, max: 30 + 1e-9 },
  { name: '31–60 min', min: 30 + 1e-9, max: 60 + 1e-9 },
  { name: '61–90 min', min: 60 + 1e-9, max: 90 + 1e-9 },
  { name: '91–120 min', min: 90 + 1e-9, max: 120 + 1e-9 },
  { name: '2–4 h', min: 120 + 1e-9, max: 240 + 1e-9 },
  { name: '>4 h', min: 240 + 1e-9, max: null },
]

export type TurnaroundRow = { type: KpiInvestigationType; orderToResult: IdRow[]; doneToReport: IdRow[] }

/**
 * Order to result (imaging: the earlier of the preliminary and the official report, because
 * this is a turnaround picture, not the compliance target) and the second leg (imaging: scan
 * done to that report; lab: received by lab to resulted), in minute bands. The unit is the
 * investigation row: `value` counts rows, `ids` the cases behind them.
 */
export function turnaroundBands(cases: ReadonlyArray<KpiCase>): TurnaroundRow[] {
  const types: KpiInvestigationType[] = ['LAB', 'CT', 'US', 'XR', 'MRI']
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

function statBy(cases: ReadonlyArray<KpiCase>, now: Date, keyOf: (c: KpiCase) => string): Map<string, StatRow> {
  const m = new Map<string, { ids: string[]; hours: number[] }>()
  for (const { c, v } of stayValues(cases, now)) {
    const key = keyOf(c)
    const row = m.get(key) ?? m.set(key, { ids: [], hours: [] }).get(key)!
    row.ids.push(c.id)
    row.hours.push(v)
  }
  return new Map([...m.entries()].map(([name, { ids, hours }]) => [name, { name, n: ids.length, ids, med: guardedMedian(hours) }]))
}

/** '1'..'5' always, in order (empty levels as zero rows), then 'Not recorded' when any case lacks a CTAS. */
export function byCtas(cases: ReadonlyArray<KpiCase>, now: Date): StatRow[] {
  const m = statBy(cases, now, (c) => (c.ctas == null ? NOT_RECORDED : String(c.ctas)))
  const rows = ['1', '2', '3', '4', '5'].map((name) => m.get(name) ?? { name, n: 0, ids: [], med: null })
  const missing = m.get(NOT_RECORDED)
  if (missing) rows.push(missing)
  return rows
}

/** Largest first, 'Not recorded' last. */
export function byArea(cases: ReadonlyArray<KpiCase>, now: Date): StatRow[] {
  const rows = [...statBy(cases, now, (c) => c.areaName ?? NOT_RECORDED).values()]
  return rows.sort((a, b) => {
    if (a.name === NOT_RECORDED) return 1
    if (b.name === NOT_RECORDED) return -1
    return b.n - a.n || a.name.localeCompare(b.name)
  })
}
