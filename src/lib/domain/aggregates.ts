/**
 * Dashboard aggregates — ported from the prototype's `Dashboard` (docs/reference/
 * ERNavigatorTracker.jsx) and locked plan sections 4 and 5.4. Pure functions over a plain case
 * shape; the server maps Prisma rows into `CaseForStats` once per request.
 *
 * Rules carried over exactly:
 *   - VOIDED cases are excluded before anything is counted (the caller passes them out, and
 *     `inRange` drops them again as a guard).
 *   - Out-of-order pairs contribute null (duration()) and are ignored by median().
 *   - Any median with fewer than MIN_N values renders as "n<3": the UI checks `n`, the maths
 *     still returns the value so tests can assert it.
 *   - Weekly buckets are Sunday-start weeks in Asia/Riyadh keyed by registration.
 *   - Every row carries the ids behind it so the UI can drill down to the case list.
 */
import { MIN_N, duration, elapsedHours, median, type CaseClock } from './time'
import { INVESTIGATION_LABELS, INVESTIGATION_STEPS, THRESHOLDS_H } from './taxonomy'
import {
  TARGETS,
  actionsDocumented,
  adaaSummary,
  admissionToUnitBands,
  byArea,
  byCtas,
  byPayer,
  phaseSplit,
  phaseSplitByOutcome,
  communication,
  completeness,
  examToConsult,
  headline,
  longestStays,
  outcomes,
  painkillerBands,
  pethidineDoses,
  previousRange,
  repeatVisits,
  stayBands,
  targets,
  treatedBands,
  turnaroundBands,
  type Actions,
  type AdaaSummaryRow,
  type Headline,
  type IdRow,
  type KpiCase,
  type LongestStay,
  type ShareRow,
  type PhaseSplit,
  type StatRow,
  type StaySplitRow,
  type TargetKey,
  type TurnaroundRow,
  type UnitType,
} from './kpi'

export const TIMEZONE = 'Asia/Riyadh'
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const RANGES = ['7', '30', '90', 'all'] as const
export type Range = (typeof RANGES)[number]

export type ConsultForStats = { departmentName: string; consultedAt: Date | null; seenAt: Date | null; repliedAt: Date | null }
export type InvestigationForStats = {
  /** Every type the taxonomy names, so Phase 8b's MRI arrives here the moment it is seeded. */
  type: keyof typeof INVESTIGATION_STEPS
  orderedAt: Date | null
  collectedAt: Date | null
  receivedAt: Date | null
  doneAt: Date | null
  /** Imaging only (Phase 8); a LAB row is always null. */
  preliminaryAt: Date | null
  resultedAt: Date | null
}

/**
 * The Phase 8b vocabularies, spelled out as literal unions the way every other enum in this file
 * is (`shift`, `disposition`) rather than imported from `@prisma/client`, which this module has
 * never depended on. They are the KPI contract's `Answer` and `UpdateActionKind`
 * (docs/specs/phase8b-decisions.md, "The KPI contract additions"): once `kpi.ts` carries them,
 * `CaseForStats` satisfies `KpiCase` structurally, as it already does for everything else here.
 */
export type Answer = 'YES' | 'NO' | 'NOT_SURE'
/** Phase 10: who pays for the visit (prisma `Payer`, restated so this module never imports the client). */
export type Payer = 'GOVERNMENT' | 'INSURED' | 'SELF_PAY'
export type UpdateActionKind =
  | 'LEADERSHIP_ESCALATION'
  | 'BED_MANAGEMENT'
  | 'FAX_RCC'
  | 'PRO_SOCIAL_WORK'
  | 'FORCED_SAFETY_ADMISSION'
  | 'DAMA_MANAGEMENT'

/**
 * One case, as every number in the app is computed from.
 *
 * Phase 8 widened it so that it structurally satisfies `KpiCase` in `src/lib/domain/kpi.ts`: the
 * Adaa KPIs need the door-to-doctor and doctor-to-decision milestones, the admission-to-unit
 * bands need the whole admission chain and the ward, the "actions documented" panel needs the
 * update count and the transfer and escalation steps, and the by-CTAS and by-area sections need
 * the two new collection fields. `departedAt` and `resolvedAt` are restated here so they are
 * required rather than optional as `CaseClock` leaves them — `toCaseForStats` has always set
 * both, and `KpiCase` reads them as plain nullable fields.
 */
export type CaseForStats = CaseClock & {
  id: string
  mrn: string
  departedAt: Date | null
  resolvedAt: Date | null
  shift: 'MORNING' | 'EVENING' | 'NIGHT' | null
  primaryReasonName: string | null
  stageNames: ReadonlyArray<string>
  /** The same stages by code (reg, triage, …), for the phase split and the filter (Phase 10). */
  stageCodes: ReadonlyArray<string>
  /**
   * Every delay reason the case carries, by name, distinct and in stage order (Phase 10). The
   * filter matches on it: `primaryReasonName` is one reason of possibly several, and "cases
   * waiting on a lab" must find a case whose primary reason is something else.
   */
  reasonNames: ReadonlyArray<string>
  departmentNames: ReadonlyArray<string>
  disposition: string | null
  consults: ReadonlyArray<ConsultForStats>
  investigations: ReadonlyArray<InvestigationForStats>
  // The journey milestones the Adaa KPIs are measured between, and the per-case timeline lists.
  triageAt: Date | null
  roomAt: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  // The admission chain, plus the escalation and transfer steps "actions documented" counts.
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
  handoverAt: Date | null
  transferRequestedAt: Date | null
  transferAcceptedAt: Date | null
  transportArrivedAt: Date | null
  medAdminInformedAt: Date | null
  /** The ward's short code (ICU, FMW …), which is how `unitTypeOf` tells an ICU from a ward. */
  wardCode: string | null
  /** Phase 8 collection fields: the triage acuity, and the name of the ED area. */
  ctas: number | null
  areaName: string | null
  /** The ED area's short code (RESUS, RAZ …), which is what the filter's URL carries (Phase 10). */
  areaCode: string | null
  /** Phase 10: who pays for the visit. */
  payer: Payer | null
  /** How many updates the case has, and when the newest was written. */
  updatesCount: number
  lastUpdateAt: Date | null
  // --- Phase 8b: Ahmed's collection decisions -------------------------------------------------
  // Every field the KPI contract names, so that the Adaa pain block, the discharge-communication
  // shares, the case-management panel, the "resolved, not reviewed" row and the deck's action
  // categories are all computed from the same one query the dashboard already issues.
  /** Pain management, Adaa KPI 8. The app only ever writes YES or NO here (decision F). */
  painkillerPrescribed: Answer | null
  pethidinePrescribed: Answer | null
  pethidineDoseMg: number | null
  painkillerAt: Date | null
  sickleCellTreatment: Answer | null
  /** Discharge communication (decision D): YES, NO or NOT_SURE. */
  instructionsGiven: Answer | null
  familyEngagement: Answer | null
  /** Case management (decision B). */
  caseMgmtReferral: 'CASE_MANAGER' | 'COMPLEX_CARE' | null
  caseMgmtCriteria: 'MEETS' | 'NOT_MEETING' | null
  caseMgmtAction: 'ENROLLED' | 'FOR_ENROLLMENT' | null
  caseMgmtCalledAt: Date | null
  caseMgmtRepliedAt: Date | null
  /** The supervisor review (decision H): when, and the reviewer's display name. */
  reviewedAt: Date | null
  reviewedByName: string | null
  /** The DISTINCT action categories on this case's updates (decision C), in no particular order. */
  updateActions: ReadonlyArray<UpdateActionKind>
  /**
   * How many of those updates carried no category at all. Counted rather than inferred: the
   * deck's seventh row is "an update was written and no action was named", and a set of distinct
   * kinds cannot say whether one plain update was written or nine.
   */
  untaggedUpdatesCount: number
  otherTexts: ReadonlyArray<{ stageName: string; text: string }>
}

export type CountRow = { name: string; value: number; ids: string[] }
export type MedianRow = { name: string; n: number; ids: string[]; med: number | null }

/** Registration within the last N days of `now` (prototype: now - reg <= days * 864e5). */
export function inRange(cases: ReadonlyArray<CaseForStats>, range: Range, now: Date): CaseForStats[] {
  const live = cases.filter((c) => c.status !== 'VOIDED')
  if (range === 'all') return live
  const ms = Number(range) * 864e5
  return live.filter((c) => now.getTime() - c.registrationAt.getTime() <= ms)
}

function countBy(cases: ReadonlyArray<CaseForStats>, keys: (c: CaseForStats) => ReadonlyArray<string | null | undefined>): CountRow[] {
  const m = new Map<string, string[]>()
  for (const c of cases) for (const k of keys(c)) if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(c.id)
  return [...m.entries()].map(([name, ids]) => ({ name, value: ids.length, ids })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

export function byPrimaryReason(cases: ReadonlyArray<CaseForStats>): CountRow[] {
  return countBy(cases, (c) => [c.primaryReasonName])
}
export function byStage(cases: ReadonlyArray<CaseForStats>): CountRow[] {
  return countBy(cases, (c) => c.stageNames)
}
export function byDepartment(cases: ReadonlyArray<CaseForStats>): CountRow[] {
  return countBy(cases, (c) => c.departmentNames)
}
export function byDisposition(cases: ReadonlyArray<CaseForStats>): CountRow[] {
  return countBy(cases.filter((c) => c.status === 'RESOLVED'), (c) => [c.disposition])
}

/** Local calendar parts in Asia/Riyadh (no DST, but computed through Intl so it stays correct). */
export function riyadhParts(d: Date): { y: number; m: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { y: Number(get('year')), m: Number(get('month')), day: Number(get('day')), weekday: DAYS.indexOf(get('weekday') as (typeof DAYS)[number]) }
}

/** ISO date (YYYY-MM-DD) of the Sunday that starts the Riyadh week containing `d`. */
export function weekKey(d: Date): string {
  const { y, m, day, weekday } = riyadhParts(d)
  const sunday = new Date(Date.UTC(y, m - 1, day - weekday))
  return sunday.toISOString().slice(0, 10)
}

export function byShift(cases: ReadonlyArray<CaseForStats>, now: Date): MedianRow[] {
  return (['MORNING', 'EVENING', 'NIGHT'] as const)
    .map((s) => {
      const cs = cases.filter((c) => c.shift === s)
      return { name: s, n: cs.length, ids: cs.map((c) => c.id), med: median(cs.map((c) => elapsedHours(c, now))) }
    })
    .filter((r) => r.n > 0)
}

export function byWeekday(cases: ReadonlyArray<CaseForStats>): CountRow[] {
  const rows = DAYS.map((name, i) => {
    const cs = cases.filter((c) => riyadhParts(c.registrationAt).weekday === i)
    return { name, value: cs.length, ids: cs.map((c) => c.id) }
  })
  return rows.filter((r) => r.value > 0)
}

export type WeekRow = { name: string; weekStart: string; cases: number; ids: string[]; med: number | null; over12: number }

export function byWeek(cases: ReadonlyArray<CaseForStats>, now: Date): WeekRow[] {
  const m = new Map<string, CaseForStats[]>()
  for (const c of cases) {
    const k = weekKey(c.registrationAt)
    ;(m.get(k) ?? m.set(k, []).get(k)!).push(c)
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      name: k.slice(5),
      weekStart: k,
      cases: v.length,
      ids: v.map((c) => c.id),
      med: median(v.map((c) => elapsedHours(c, now))),
      over12: v.filter((c) => (elapsedHours(c, now) ?? 0) >= 12).length,
    }))
}

// --- Phase 11: the last days, and when the patients arrive ---------------------------------------

export type Weekday = (typeof DAYS)[number]

/**
 * One formatter for the Riyadh day and hour of an instant, made once: `byDay` and `arrivalGrid`
 * ask it once per case, and an all-time dashboard is every case the department has flagged.
 * `hourCycle: 'h23'`, because 'hour12: false' prints midnight as "24" on some engines.
 */
const RIYADH_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
})

/** The Asia/Riyadh calendar day (YYYY-MM-DD), weekday (0 = Sunday) and hour (0–23) of an instant. */
export function riyadhClock(d: Date): { date: string; weekday: number; hour: number } {
  const parts = RIYADH_CLOCK.formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: DAYS.indexOf(get('weekday') as Weekday),
    hour: Number(get('hour')),
  }
}

/** A calendar date plus whole days, as dates rather than instants (no DST in Riyadh, but no drift either). */
function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export type DayRow = {
  /** The Riyadh calendar day, YYYY-MM-DD. Also the drill key (`day:2026-09-08`). */
  date: string
  /** "dd/mm", the axis label. */
  name: string
  weekday: Weekday
  cases: number
  ids: string[]
  /** Median total ED stay over the day's cases with a computable stay; null below MIN_N of them. */
  med: number | null
}

/**
 * The last days, one row per Asia/Riyadh calendar day keyed by registration (Phase 11): every day
 * from the one the range's window opens on to today, the empty ones included, so a quiet day is a
 * gap on the chart rather than a day that is not there. The window is `inRange`'s — the last N x
 * 24 hours — so it opens part way through a day, and seven days is eight bars.
 *
 * 'all' has no window, so it runs from the first case's day. Either way the list is stretched to
 * cover every case it is given, a registration dated after today included, so that the bars
 * always add up to the cases on the page.
 *
 * Unlike `byWeek`, the median is guarded here and not in the chart: a day is a small bucket, and
 * "a day under 3 cases shows no median" belongs where it cannot be forgotten. It counts the stays
 * that can be computed, not the cases, so three cases with one impossible leaving time are two.
 */
export function byDay(cases: ReadonlyArray<CaseForStats>, range: Range, now: Date): DayRow[] {
  const byDate = new Map<string, CaseForStats[]>()
  for (const c of cases) {
    if (c.status === 'VOIDED') continue
    const date = riyadhClock(c.registrationAt).date
    ;(byDate.get(date) ?? byDate.set(date, []).get(date)!).push(c)
  }
  const dates = [...byDate.keys()].sort()
  const today = riyadhClock(now).date
  const opens = range === 'all' ? (dates[0] ?? today) : riyadhClock(new Date(now.getTime() - Number(range) * 864e5)).date
  const first = dates[0] != null && dates[0] < opens ? dates[0] : opens
  const last = dates.at(-1) != null && dates.at(-1)! > today ? dates.at(-1)! : today

  const rows: DayRow[] = []
  for (let date = first; date <= last; date = addCalendarDays(date, 1)) {
    const cs = byDate.get(date) ?? []
    const stays = cs.map((c) => elapsedHours(c, now)).filter((h): h is number => h != null)
    const [y, m, d] = date.split('-').map(Number) as [number, number, number]
    rows.push({
      date,
      name: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      weekday: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!,
      cases: cs.length,
      ids: cs.map((c) => c.id),
      med: stays.length >= MIN_N ? median(stays) : null,
    })
  }
  return rows
}

/** The eight three-hour blocks of the arrivals table, by Riyadh registration time. */
export const ARRIVAL_BLOCKS = ['00–03', '03–06', '06–09', '09–12', '12–15', '15–18', '18–21', '21–24'] as const
export type ArrivalBlock = (typeof ARRIVAL_BLOCKS)[number]
export type ArrivalCell = { block: ArrivalBlock; value: number; ids: string[] }
export type ArrivalGrid = {
  /** Sunday to Saturday, each with all eight blocks, the empty cells kept. */
  rows: Array<{ weekday: Weekday; cells: ArrivalCell[] }>
  /** The fullest cell's count, which the table steps its fills against; 0 when there is nothing. */
  max: number
}

/**
 * When the delayed patients arrive (Phase 11): each case under the Asia/Riyadh weekday and the
 * three-hour block of its registration. A block starts on its hour — 03:00:00 is "03–06", a
 * second before it "00–03".
 */
export function arrivalGrid(cases: ReadonlyArray<CaseForStats>): ArrivalGrid {
  const rows = DAYS.map((weekday) => ({
    weekday,
    cells: ARRIVAL_BLOCKS.map((block): ArrivalCell => ({ block, value: 0, ids: [] })),
  }))
  for (const c of cases) {
    if (c.status === 'VOIDED') continue
    const { weekday, hour } = riyadhClock(c.registrationAt)
    const cell = rows[weekday]?.cells[Math.floor(hour / 3)]
    if (!cell) continue
    cell.value += 1
    cell.ids.push(c.id)
  }
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.value)))
  return { rows, max }
}

export type ConsultRow = { name: string; n: number; ids: string[]; toSeen: number | null; toReply: number | null }

/** Per team: cases with a consultedAt for that team; medians of consult→seen and consult→reply. */
export function consultRows(cases: ReadonlyArray<CaseForStats>): ConsultRow[] {
  const teams = new Map<string, { ids: string[]; seen: (number | null)[]; reply: (number | null)[] }>()
  for (const c of cases)
    for (const x of c.consults) {
      if (!x.consultedAt) continue
      const t = teams.get(x.departmentName) ?? teams.set(x.departmentName, { ids: [], seen: [], reply: [] }).get(x.departmentName)!
      t.ids.push(c.id)
      t.seen.push(duration(x.consultedAt, x.seenAt))
      t.reply.push(duration(x.consultedAt, x.repliedAt))
    }
  return [...teams.entries()]
    .map(([name, t]) => ({ name, n: t.ids.length, ids: t.ids, toSeen: median(t.seen), toReply: median(t.reply) }))
    .sort((a, b) => (b.toReply ?? b.toSeen ?? 0) - (a.toReply ?? a.toSeen ?? 0) || a.name.localeCompare(b.name))
}

export type InvestigationRow = { type: keyof typeof INVESTIGATION_STEPS; name: string; n: number; ids: string[]; toMid: number | null; toDone: number | null }

/**
 * Per test type: order→mid step (collected / scan done) and order→final (resulted / reported).
 * `mid` and `last` are read off `INVESTIGATION_STEPS` by position, and Phase 8's "Preliminary
 * report" was inserted between the scan and the official report, so both are unchanged: still
 * `doneAt` and still `resultedAt`.
 */
export function investigationRows(cases: ReadonlyArray<CaseForStats>): InvestigationRow[] {
  return (Object.keys(INVESTIGATION_STEPS) as Array<keyof typeof INVESTIGATION_STEPS>)
    .map((type) => {
      const steps = INVESTIGATION_STEPS[type]
      const mid = steps[1]![0]
      const last = steps[steps.length - 1]![0]
      const xs = cases.flatMap((c) => c.investigations.filter((x) => x.type === type && x.orderedAt).map((x) => ({ id: c.id, x })))
      return {
        type,
        name: INVESTIGATION_LABELS[type],
        n: xs.length,
        ids: xs.map((v) => v.id),
        toMid: median(xs.map((v) => duration(v.x.orderedAt, v.x[mid]))),
        toDone: median(xs.map((v) => duration(v.x.orderedAt, v.x[last]))),
      }
    })
    .filter((r) => r.n > 0)
}

export type AdmissionStats = { n: number; ids: string[]; orderToBed: number | null; requestToBed: number | null; bedToLeave: number | null }

export function admissionStats(cases: ReadonlyArray<CaseForStats>): AdmissionStats {
  const withOrder = cases.filter((c) => c.admOrderAt)
  return {
    n: withOrder.length,
    ids: withOrder.map((c) => c.id),
    orderToBed: median(cases.map((c) => duration(c.admOrderAt, c.bedAssignedAt))),
    requestToBed: median(cases.map((c) => duration(c.bedRequestedAt, c.bedAssignedAt))),
    bedToLeave: median(cases.map((c) => duration(c.bedAssignedAt, c.departedAt))),
  }
}

export type ThresholdRow = { threshold: number; openNow: number; openIds: string[]; allCases: number; allIds: string[] }

/** openPast(t): OPEN cases with elapsed >= t. allPast(t): every non-voided case in range with elapsed >= t. */
export function thresholdTable(cases: ReadonlyArray<CaseForStats>, now: Date): ThresholdRow[] {
  return THRESHOLDS_H.map((t) => {
    const all = cases.filter((c) => (elapsedHours(c, now) ?? -1) >= t)
    const open = all.filter((c) => c.status === 'OPEN')
    return { threshold: t, openNow: open.length, openIds: open.map((c) => c.id), allCases: all.length, allIds: all.map((c) => c.id) }
  })
}

export type Tiles = { openNow: number; openPast6: number; resolvedN: number; medianLos: number | null }

export function tiles(cases: ReadonlyArray<CaseForStats>, now: Date): Tiles {
  const open = cases.filter((c) => c.status === 'OPEN')
  const resolved = cases.filter((c) => c.status === 'RESOLVED')
  return {
    openNow: open.length,
    openPast6: open.filter((c) => (elapsedHours(c, now) ?? -1) >= 6).length,
    resolvedN: resolved.length,
    medianLos: median(resolved.map((c) => elapsedHours(c, now))),
  }
}

export type OtherQueueRow = { id: string; mrn: string; stageName: string; text: string }

export function otherQueue(cases: ReadonlyArray<CaseForStats>): OtherQueueRow[] {
  return cases.flatMap((c) => c.otherTexts.filter((o) => o.text.trim()).map((o) => ({ id: c.id, mrn: c.mrn, stageName: o.stageName, text: o.text })))
}

// --- Phase 8: the deck and Adaa panels ---------------------------------------------------------

/** One working target with the drill-down the section needs: the cases that did NOT meet it. */
export type DashboardTarget = ShareRow & { key: TargetKey; minutes: number; missedIds: string[] }

/**
 * Everything the Phase 8 sections render, computed once per request by `dashboard()`.
 *
 * Every figure is a call into `src/lib/domain/kpi.ts` — this layer names them, puts the six
 * `completeness` rows into one drillable list, and takes the set difference `ids − withinIds` a
 * "who missed this target" drill-down needs. The only arithmetic it does that `kpi.ts` does not
 * hand over is the two headline shares, and they are guarded by `MIN_N` like every other share.
 */
/**
 * `headline()` plus the two shares it reports as counts.
 *
 * The headline tile asks for the share of stays at 10 h or more (brief, section 3, item 1) and
 * `kpi.ts` hands over the count. The denominator is `measured` — the cases with a computable
 * stay, which is what the count is drawn from — and the share is null below MIN_N, like every
 * other share in the app. This is the only arithmetic this module does on top of `kpi.ts`.
 */
export type HeadlineFigures = Headline & { atLeast10Share: number | null; atLeast12Share: number | null }

export type DashboardKpi = {
  headline: HeadlineFigures
  /** The period of the same length before this one, measured to `asOf`. Null for 'all'. */
  previous: { headline: HeadlineFigures; asOf: Date } | null
  stayBands: IdRow[]
  longest: LongestStay[]
  actions: Actions
  outcomes: IdRow[]
  /** The six data-quality rows in a fixed order, so the panel and the drill-down share one list. */
  completeness: IdRow[]
  repeats: Array<{ mrn: string; ids: string[] }>
  adaa: AdaaSummaryRow[]
  /** `adaa`'s last row: the one the dashboard panel shows. Per-CTAS rows are for the export. */
  adaaOverall: AdaaSummaryRow
  treated: IdRow[]
  /**
   * Phase 8b. `adaaOverall` already carries the pain block's counts, but only as numbers: these
   * three carry the case ids behind each row, which is what a drill-down needs. Same functions,
   * same case list — `painkiller[i].value` is `adaaOverall.painkiller[i]` by construction.
   */
  painkiller: IdRow[]
  pethidine: IdRow[]
  /** Decision D's two discharge-communication rows, as shares of the cases that answered. */
  communication: ShareRow[]
  admissionToUnit: Array<{ unit: UnitType; bands: IdRow[] }>
  targets: DashboardTarget[]
  examToConsult: StatRow[]
  turnaround: TurnaroundRow[]
  byCtas: StatRow[]
  byArea: StatRow[]
  /** Phase 10: the stay in three parts, and the cases by payer. */
  phases: PhaseSplit
  byPayer: StatRow[]
  /** Phase 11: the same three parts over the complete cases, overall and by outcome group. */
  staySplit: StaySplitRow[]
}

function guardedShare(within: number, n: number): number | null {
  return n >= MIN_N ? within / n : null
}

// `KpiCase`, not `CaseForStats`: `previousRange` hands back the structural subset it filtered.
function figures(cases: ReadonlyArray<KpiCase>, asOf: Date): HeadlineFigures {
  const head = headline(cases, asOf)
  return {
    ...head,
    atLeast10Share: guardedShare(head.atLeast10, head.measured),
    atLeast12Share: guardedShare(head.atLeast12, head.measured),
  }
}

export function kpiPanels(all: ReadonlyArray<CaseForStats>, cases: ReadonlyArray<CaseForStats>, range: Range, now: Date): DashboardKpi {
  // 'all' has no period before it; `previousRange` returns an empty window and no delta is shown.
  const before = previousRange(all, range, now)
  const rows = completeness(cases, now)
  const adaa = adaaSummary(cases)
  return {
    headline: figures(cases, now),
    // Measured to the end of its own period, never to `now`: a case still open then must not be
    // given today's clock (kpi.ts, `previousRange`).
    previous: range === 'all' ? null : { headline: figures(before.cases, before.asOf), asOf: before.asOf },
    stayBands: stayBands(cases, now),
    longest: longestStays(cases, now),
    actions: actionsDocumented(cases),
    outcomes: outcomes(cases),
    completeness: [
      rows.noReason,
      rows.openQuiet12h,
      rows.noDecision24h,
      rows.resolvedNoDisposition,
      rows.outOfOrder,
      rows.noStay,
      rows.resolvedNotReviewed,
      rows.painkillerNoTime,
      rows.pethidineNoDose,
    ],
    repeats: repeatVisits(cases),
    adaa,
    adaaOverall: adaa[adaa.length - 1]!,
    treated: treatedBands(cases),
    painkiller: painkillerBands(cases),
    pethidine: pethidineDoses(cases),
    communication: communication(cases),
    admissionToUnit: admissionToUnitBands(cases),
    targets: targets(cases).map((row, i) => {
      const within = new Set(row.withinIds)
      return { ...row, key: TARGETS[i]!.key, minutes: TARGETS[i]!.minutes, missedIds: row.ids.filter((id) => !within.has(id)) }
    }),
    examToConsult: examToConsult(cases),
    turnaround: turnaroundBands(cases),
    byCtas: byCtas(cases, now),
    byArea: byArea(cases, now),
    phases: phaseSplit(cases),
    byPayer: byPayer(cases, now),
    staySplit: phaseSplitByOutcome(cases),
  }
}

/**
 * Everything the dashboard page renders, in one call. `byPrimary` and `byDept` are capped to the
 * top 8 here because that is what the prototype's charts show (a rendering cap, verified by three
 * independent recomputations of the fixture); the uncapped lists come from byPrimaryReason() and
 * byDepartment() directly.
 *
 * Phase 8 added `kpi`: the weekly deck's headline, bands, longest stays, actions, outcomes and
 * completeness, and the Adaa and August-sheet panels. Those come from `kpi.ts` over the same
 * `cases` list, except `previousRange`, which needs the unfiltered `all` to find the window
 * before this one.
 */
export function dashboard(all: ReadonlyArray<CaseForStats>, range: Range, now: Date) {
  const cases = inRange(all, range, now)
  return {
    range,
    total: all.filter((c) => c.status !== 'VOIDED').length,
    inRange: cases.length,
    tiles: tiles(cases, now),
    thresholds: thresholdTable(cases, now),
    weeks: byWeek(cases, now),
    /** Phase 11: drawn on the 7- and 30-day ranges, where the weekly chart has too few weeks. */
    days: byDay(cases, range, now),
    arrivals: arrivalGrid(cases),
    byPrimary: byPrimaryReason(cases).slice(0, 8),
    byStage: byStage(cases),
    byDept: byDepartment(cases).slice(0, 8),
    consults: consultRows(cases),
    investigations: investigationRows(cases),
    admission: admissionStats(cases),
    byShift: byShift(cases, now),
    byWeekday: byWeekday(cases),
    byDispo: byDisposition(cases),
    otherQueue: otherQueue(cases),
    kpi: kpiPanels(all, cases, range, now),
  }
}
