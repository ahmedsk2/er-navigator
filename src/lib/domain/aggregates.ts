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
import { duration, elapsedHours, median, type CaseClock } from './time'
import { INVESTIGATION_LABELS, INVESTIGATION_STEPS, THRESHOLDS_H } from './taxonomy'

export const TIMEZONE = 'Asia/Riyadh'
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const RANGES = ['7', '30', '90', 'all'] as const
export type Range = (typeof RANGES)[number]

export type ConsultForStats = { departmentName: string; consultedAt: Date | null; seenAt: Date | null; repliedAt: Date | null }
export type InvestigationForStats = {
  type: keyof typeof INVESTIGATION_STEPS
  orderedAt: Date | null
  collectedAt: Date | null
  receivedAt: Date | null
  doneAt: Date | null
  /** Imaging only (Phase 8); a LAB row is always null. */
  preliminaryAt: Date | null
  resultedAt: Date | null
}

export type CaseForStats = CaseClock & {
  id: string
  mrn: string
  shift: 'MORNING' | 'EVENING' | 'NIGHT' | null
  primaryReasonName: string | null
  stageNames: ReadonlyArray<string>
  departmentNames: ReadonlyArray<string>
  disposition: string | null
  consults: ReadonlyArray<ConsultForStats>
  investigations: ReadonlyArray<InvestigationForStats>
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
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

/**
 * Everything the dashboard page renders, in one call. `byPrimary` and `byDept` are capped to the
 * top 8 here because that is what the prototype's charts show (a rendering cap, verified by three
 * independent recomputations of the fixture); the uncapped lists come from byPrimaryReason() and
 * byDepartment() directly.
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
  }
}
