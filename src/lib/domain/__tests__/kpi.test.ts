import { describe, expect, it } from 'vitest'
import { MIN_N } from '../time'
import {
  ADMISSION_BANDS,
  actionsDocumented,
  adaaSummary,
  admissionToUnitBands,
  benchmark,
  byArea,
  byCtas,
  communication,
  completeness,
  doorAt,
  doorToDispositionHours,
  examToConsult,
  headline,
  hoursBetween,
  isOutOfOrder,
  kpi1Minutes,
  kpi2Minutes,
  kpi3Minutes,
  kpi8Minutes,
  leftAt,
  longestStays,
  minutesBetween,
  outcomes,
  painkillerBands,
  pethidineDoses,
  previousRange,
  repeatVisits,
  STAY_BANDS,
  stayBands,
  targets,
  timeline,
  TREATED_BANDS,
  treatedBandIndex,
  treatedBands,
  TURNAROUND_BANDS,
  turnaroundBands,
  unitTypeOf,
  type KpiCase,
  byPayer,
  phaseHours,
  phaseSplit,
  OUTCOME_GROUPS,
  outcomeGroupOf,
  phaseSplitByOutcome,
} from '../kpi'

/** 2026-09-09 12:00 UTC = 15:00 Riyadh. Every fixture time is relative to this. */
const NOW = new Date('2026-09-09T12:00:00.000Z')
const T = (hoursBeforeNow: number): Date => new Date(NOW.getTime() - hoursBeforeNow * 3_600_000)

function base(id: string, over: Partial<KpiCase> = {}): KpiCase {
  return {
    id,
    mrn: `10${id}`,
    status: 'OPEN',
    registrationAt: T(8),
    departedAt: null,
    resolvedAt: null,
    triageAt: null,
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    medAdminInformedAt: null,
    disposition: null,
    wardCode: null,
    ctas: null,
    areaName: null,
    payer: null,
    stageNames: [],
    stageCodes: [],
    updatesCount: 0,
    lastUpdateAt: null,
    consults: [],
    investigations: [],
    painkillerPrescribed: null,
    pethidinePrescribed: null,
    pethidineDoseMg: null,
    painkillerAt: null,
    sickleCellTreatment: null,
    instructionsGiven: null,
    familyEngagement: null,
    caseMgmtReferral: null,
    caseMgmtCriteria: null,
    caseMgmtAction: null,
    caseMgmtCalledAt: null,
    caseMgmtRepliedAt: null,
    reviewedAt: null,
    reviewedByName: null,
    updateActions: [],
    untaggedUpdatesCount: 0,
    ...over,
  }
}

/**
 * The fixture, by hand:
 *  a  open,     reg 8 h ago                                   stay 8.0   (open)
 *  b  open,     reg 26.5 h ago, escalated, 1 update           stay 26.5
 *  c  resolved, reg 13 h ago, left 3 h ago                    stay 10.0  ADMITTED to MMW
 *  d  resolved, reg 30 h ago, left 24 h ago                   stay 6.0   DISCHARGED_DAMA
 *  e  resolved, reg 20 h ago, left 15.5 h ago                 stay 4.5   DISCHARGED_HOME (same MRN as a)
 *  v  voided (ignored everywhere)
 */
const a = base('a', { ctas: 3, areaName: 'Acute area', stageNames: ['Investigations'], stageCodes: ['inv'] })
const b = base('b', {
  registrationAt: T(26.5),
  ctas: 2,
  areaName: 'Resuscitation area',
  stageNames: ['Referral / consulted team', 'Admission process'],
  stageCodes: ['ref', 'adm'],
  payer: 'INSURED',
  medAdminInformedAt: T(2),
  updatesCount: 1,
  untaggedUpdatesCount: 1,
  lastUpdateAt: T(2),
  triageAt: T(26.25),
  physicianAt: T(26),
  decisionAt: T(20),
  admOrderAt: T(19),
  bedRequestedAt: T(18),
  consults: [{ departmentName: 'Internal Medicine', consultedAt: T(25), seenAt: T(24), repliedAt: T(23) }],
})
const c = base('c', {
  status: 'RESOLVED',
  registrationAt: T(13),
  departedAt: T(3),
  resolvedAt: T(3),
  ctas: 3,
  areaName: 'Acute area',
  stageNames: ['Admission process'],
  stageCodes: ['adm'],
  payer: 'GOVERNMENT',
  disposition: 'ADMITTED',
  wardCode: 'MMW',
  triageAt: T(12.75),
  physicianAt: T(12.5),
  decisionAt: T(10),
  admOrderAt: T(9),
  bedRequestedAt: T(8),
  bedAssignedAt: T(4),
  updatesCount: 2,
  untaggedUpdatesCount: 2,
  lastUpdateAt: T(3),
  consults: [{ departmentName: 'Internal Medicine', consultedAt: T(12), seenAt: null, repliedAt: T(11.5) }],
  investigations: [
    { type: 'LAB', orderedAt: T(12.4), collectedAt: T(12.2), receivedAt: T(12), doneAt: null, preliminaryAt: null, resultedAt: T(11.5) },
    { type: 'CT', orderedAt: T(12), collectedAt: null, receivedAt: null, doneAt: T(11), preliminaryAt: T(10.5), resultedAt: T(9) },
  ],
})
const d = base('d', {
  status: 'RESOLVED',
  registrationAt: T(30),
  departedAt: T(24),
  resolvedAt: T(24),
  ctas: 4,
  disposition: 'DISCHARGED_DAMA',
  physicianAt: T(29),
  decisionAt: T(28),
  stageNames: ['Discharge process'],
  stageCodes: ['dc'],
  payer: 'GOVERNMENT',
  investigations: [{ type: 'LAB', orderedAt: T(29), collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: T(27.5) }],
})
const e = base('e', {
  mrn: '10a',
  status: 'RESOLVED',
  registrationAt: T(20),
  departedAt: T(15.5),
  resolvedAt: T(15.5),
  ctas: 5,
  disposition: 'DISCHARGED_HOME',
  physicianAt: T(19.75),
  decisionAt: T(17),
  stageNames: ['Investigations'],
  stageCodes: ['inv'],
  payer: 'SELF_PAY',
  investigations: [{ type: 'XR', orderedAt: T(19.5), collectedAt: null, receivedAt: null, doneAt: T(19), preliminaryAt: null, resultedAt: T(18) }],
})
const v = base('v', { status: 'VOIDED', registrationAt: T(40) })
const ALL = [a, b, c, d, e, v]

describe('durations and the two shared definitions', () => {
  it('are hours or minutes, null when missing or impossible', () => {
    expect(hoursBetween(T(2), T(1))).toBe(1)
    expect(minutesBetween(T(2), T(1.5))).toBe(30)
    expect(hoursBetween(T(1), T(2))).toBeNull()
    expect(hoursBetween(null, T(1))).toBeNull()
    expect(hoursBetween(T(1), null)).toBeNull()
  })

  it('the door is the earlier of registration and triage', () => {
    expect(doorAt(c)).toEqual(T(13))
    expect(doorAt(base('t', { registrationAt: T(10), triageAt: T(10.5) }))).toEqual(T(10.5))
    expect(doorAt(a)).toEqual(T(8))
  })

  it('leaving is departed, else resolved, and only for a resolved case', () => {
    expect(leftAt(c)).toEqual(T(3))
    expect(leftAt(base('r', { status: 'RESOLVED', resolvedAt: T(1) }))).toEqual(T(1))
    // A reopened case keeps its old departure time but is open again everywhere.
    expect(leftAt(base('o', { status: 'OPEN', departedAt: T(2), resolvedAt: null }))).toBeNull()
  })
})

describe('the weekly deck', () => {
  it('headline: cases, measured, episodes, median, mean, range, 10 h and 12 h shares, longest', () => {
    const h = headline(ALL, NOW)
    expect(h.cases).toBe(5)
    expect(h.measured).toBe(5)
    expect(h.episodes).toBe(4) // a and e share an MRN
    // stays: 8, 26.5, 10, 6, 4.5 -> sorted 4.5 6 8 10 26.5
    expect(h.med).toBe(8)
    expect(h.mean).toBeCloseTo((8 + 26.5 + 10 + 6 + 4.5) / 5, 10)
    expect(h.min).toBe(4.5)
    expect(h.max).toBe(26.5)
    expect(h.atLeast10).toBe(2)
    expect(h.atLeast12).toBe(1)
    expect(h.longest).toEqual({ id: 'b', mrn: '10b', hours: 26.5 })
  })

  it('headline below n<3 keeps counts, min, max and the longest but no median or mean', () => {
    const h = headline([a, b], NOW)
    expect(h.cases).toBe(2)
    expect(h.med).toBeNull()
    expect(h.mean).toBeNull()
    expect(h.min).toBe(8)
    expect(h.max).toBe(26.5)
    expect(h.longest?.id).toBe('b')
  })

  it('headline counts a future-dated registration as a case but not as measured', () => {
    const future = base('f', { registrationAt: T(-1) })
    const h = headline([...ALL, future], NOW)
    expect(h.cases).toBe(6)
    expect(h.measured).toBe(5)
    expect(stayBands([...ALL, future], NOW).reduce((n, r) => n + r.value, 0)).toBe(5)
  })

  it('stay bands are half-open and ordered', () => {
    expect(STAY_BANDS.map((b) => b.name)).toEqual(['<6 h', '6–<8 h', '8–<10 h', '10–<12 h', '12–<24 h', '24+ h'])
    const rows = stayBands(ALL, NOW)
    expect(rows.map((r) => [r.name, r.value])).toEqual([
      ['<6 h', 1],
      ['6–<8 h', 1],
      ['8–<10 h', 1],
      ['10–<12 h', 1],
      ['12–<24 h', 0],
      ['24+ h', 1],
    ])
    expect(rows[2]!.ids).toEqual(['a'])
    expect(rows[3]!.ids).toEqual(['c'])
  })

  it('stay band edges: 6.0 is 6–<8, 8.0 is 8–<10, 24.0 is 24+', () => {
    const at = (h: number) => base(`s${h}`, { status: 'RESOLVED', registrationAt: T(h), departedAt: T(0) })
    const rows = stayBands([at(5.999), at(6), at(8), at(10), at(12), at(24)], NOW)
    expect(rows.map((r) => r.value)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('previousRange is the window just before, with the instant it ended', () => {
    const { cases, asOf } = previousRange(ALL, '7', NOW)
    expect(cases).toEqual([])
    expect(asOf).toEqual(T(7 * 24))
    const old = base('old', { registrationAt: T(24 * 10) }) // open, registered 10 days ago
    const prev = previousRange([...ALL, old], '7', NOW)
    expect(prev.cases.map((c) => c.id)).toEqual(['old'])
    // Measured to the end of its own period (3 days after registration), not to today.
    expect(headline(prev.cases, prev.asOf).longest?.hours).toBe(72)
    expect(headline(prev.cases, NOW).longest?.hours).toBe(240)
    expect(previousRange([...ALL, old], '30', NOW).cases).toEqual([])
    expect(previousRange([...ALL, old], 'all', NOW)).toEqual({ cases: [], asOf: NOW })
  })

  it('longest stays are ranked, capped and carry what the table shows', () => {
    const rows = longestStays(ALL, NOW, 3)
    expect(rows.map((r) => [r.mrn, r.hours])).toEqual([
      ['10b', 26.5],
      ['10c', 10],
      ['10a', 8],
    ])
    expect(rows[0]).toMatchObject({ status: 'OPEN', disposition: null, stageNames: ['Referral / consulted team', 'Admission process'] })
    expect(rows[1]).toMatchObject({ status: 'RESOLVED', disposition: 'ADMITTED' })
  })

  it('actions documented: the deck\'s categories, with the recorded signals folded in', () => {
    // b: escalation timestamp + fax + one untagged update; c: fax + two untagged updates
    const acts = actionsDocumented(ALL)
    expect(acts.any).toEqual({ name: 'Action documented', value: 2, ids: ['b', 'c'] })
    expect(acts.none.ids).toEqual(['a', 'd', 'e'])
    expect(acts.byKind.map((r) => [r.name, r.value])).toEqual([
      ['Leadership escalation', 1],
      ['Case / bed management', 2],
      ['External transfer / fax / RCC', 0],
      ['PRO / social work', 0],
      ['Forced / safety admission', 0],
      ['DAMA management', 0],
      ['Update without an action tag', 2],
    ])
    // A tagged update counts under its category and not as untagged; a mixed case counts both.
    const tagged = base('t1', { updatesCount: 1, updateActions: ['PRO_SOCIAL_WORK'], untaggedUpdatesCount: 0 })
    const mixed = base('t2', { updatesCount: 3, updateActions: ['DAMA_MANAGEMENT', 'FAX_RCC'], untaggedUpdatesCount: 1 })
    // Two updates both tagged "bed management": two tagged updates, none untagged.
    const repeated = base('t3', { updatesCount: 2, updateActions: ['BED_MANAGEMENT'], untaggedUpdatesCount: 0 })
    const rows = actionsDocumented([tagged, mixed, repeated]).byKind
    const by = Object.fromEntries(rows.map((r) => [r.name, r.ids]))
    expect(by['PRO / social work']).toEqual(['t1'])
    expect(by['DAMA management']).toEqual(['t2'])
    expect(by['External transfer / fax / RCC']).toEqual(['t2'])
    expect(by['Case / bed management']).toEqual(['t3'])
    expect(by['Update without an action tag']).toEqual(['t2'])
  })

  it('outcomes: resolved by disposition label, largest first, then the open ones', () => {
    expect(outcomes(ALL).map((r) => [r.name, r.value])).toEqual([
      ['Admitted', 1],
      ['Discharged DAMA', 1],
      ['Discharged home', 1],
      ['Still open', 2],
    ])
  })

  it('completeness flags the six data-quality rows', () => {
    const quiet = base('q', { registrationAt: T(13), stageNames: ['Triage'] }) // open, no update, 13 h
    const noDispo = base('n', { status: 'RESOLVED', registrationAt: T(10), resolvedAt: T(1), stageNames: ['Triage'] })
    const swapped = base('s', { physicianAt: T(1), decisionAt: T(2), stageNames: ['Triage'] })
    const bare = base('z', { registrationAt: T(1) })
    const undecided = base('u', { registrationAt: T(30), stageNames: ['Admission process'], updatesCount: 1, lastUpdateAt: T(2) })
    const future = base('f', { registrationAt: T(-1), stageNames: ['Triage'] })
    const rows = completeness([...ALL, quiet, noDispo, swapped, bare, undecided, future], NOW)
    expect(rows.noReason.ids).toEqual(['z'])
    expect(rows.openQuiet12h.ids).toEqual(['q']) // a is 8 h old with no update; b was updated 2 h ago
    expect(rows.noDecision24h.ids).toEqual(['u']) // b is 26.5 h old but has a decision
    expect(rows.resolvedNoDisposition.ids).toEqual(['n'])
    expect(rows.outOfOrder.ids).toEqual(['s'])
    expect(rows.noStay.ids).toEqual(['f'])
    expect(rows.resolvedNotReviewed.ids).toEqual(['c', 'd', 'e', 'n'])
    expect(isOutOfOrder(c)).toBe(false)
    const reviewed = completeness([{ ...c, reviewedAt: T(1), reviewedByName: 'Sami Supervisor' }], NOW)
    expect(reviewed.resolvedNotReviewed.ids).toEqual([])
  })

  it('out-of-order checks every sequence: milestones, admission, transfer, consults, investigations', () => {
    expect(isOutOfOrder(base('m', { triageAt: T(7), roomAt: T(7.5) }))).toBe(true)
    expect(isOutOfOrder(base('m2', { registrationAt: T(8), triageAt: T(8.5) }))).toBe(true)
    expect(isOutOfOrder(base('ad', { admOrderAt: T(2), bedRequestedAt: T(3) }))).toBe(true)
    expect(isOutOfOrder(base('tr', { transferRequestedAt: T(2), transferAcceptedAt: T(3) }))).toBe(true)
    expect(isOutOfOrder(base('co', { consults: [{ departmentName: 'ICU', consultedAt: T(2), seenAt: T(3), repliedAt: null }] }))).toBe(true)
    expect(isOutOfOrder(base('lab', { investigations: [{ type: 'LAB', orderedAt: T(2), collectedAt: T(3), receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: null }] }))).toBe(true)
    expect(isOutOfOrder(base('ct', { investigations: [{ type: 'CT', orderedAt: T(3), collectedAt: null, receivedAt: null, doneAt: T(2), preliminaryAt: T(1), resultedAt: T(1.5) }] }))).toBe(true)
    expect(isOutOfOrder(base('cm', { caseMgmtCalledAt: T(2), caseMgmtRepliedAt: T(3) }))).toBe(true)
    expect(isOutOfOrder(base('pk', { registrationAt: T(8), painkillerAt: T(9) }))).toBe(true)
    expect(isOutOfOrder(base('mri', { investigations: [{ type: 'MRI', orderedAt: T(3), collectedAt: null, receivedAt: null, doneAt: T(4), preliminaryAt: null, resultedAt: null }] }))).toBe(true)
    expect(isOutOfOrder(base('ok', { triageAt: T(7.5), roomAt: T(7), physicianAt: T(7), decisionAt: T(2) }))).toBe(false)
  })

  it('repeat visits: the MRN that appears twice', () => {
    expect(repeatVisits(ALL)).toEqual([{ mrn: '10a', ids: ['a', 'e'] }])
  })
})

describe('the per-case timeline', () => {
  it('lists every recorded step in time order with the interval from the previous one', () => {
    const steps = timeline(c)
    expect(steps.map((s) => s.label)).toEqual([
      'Registration',
      'Triage',
      'First physician contact',
      'Lab: ordered',
      'Lab: sample collected',
      'Lab: received by lab',
      'CT: ordered',
      'Internal Medicine: consulted',
      'Lab: resulted',
      'Internal Medicine: replied / plan given',
      'CT: scan done',
      'CT: preliminary report',
      'Disposition decided',
      'CT: reported',
      'Admission order written',
      'Bed requested (fax sent)',
      'Bed assigned',
      'Left ED',
    ])
    expect(steps[0]!.fromPrevious).toBeNull()
    expect(steps[1]!.fromPrevious).toBeCloseTo(0.25, 10)
    expect(steps.at(-1)!.fromPrevious).toBeCloseTo(1, 10)
    const atTwelve = steps.filter((s) => s.at.getTime() === T(12).getTime()).map((s) => s.label)
    expect(atTwelve).toEqual(['Lab: received by lab', 'CT: ordered', 'Internal Medicine: consulted'])
    const atNine = steps.filter((s) => s.at.getTime() === T(9).getTime()).map((s) => s.label)
    expect(atNine).toEqual(['CT: reported', 'Admission order written'])
  })

  it('does not depend on how the rows were loaded: ties break by type order and department name', () => {
    const shuffled: KpiCase = {
      ...c,
      investigations: [...c.investigations].reverse(),
      consults: [{ departmentName: 'Urology', consultedAt: T(12), seenAt: null, repliedAt: null }, ...c.consults],
    }
    const atTwelve = timeline(shuffled)
      .filter((s) => s.at.getTime() === T(12).getTime())
      .map((s) => s.label)
    expect(atTwelve).toEqual(['Lab: received by lab', 'CT: ordered', 'Internal Medicine: consulted', 'Urology: consulted'])
  })

  it('keeps every key unique with two rows of one type and two consults to one department, and shows the transfer chain and the room', () => {
    const t = base('tx', {
      status: 'RESOLVED',
      registrationAt: T(10),
      roomAt: T(9.5),
      transferRequestedAt: T(6),
      transferAcceptedAt: T(4),
      transportArrivedAt: T(2),
      departedAt: T(1.5),
      resolvedAt: T(1.5),
      disposition: 'TRANSFERRED',
      investigations: [
        { type: 'CT', orderedAt: T(9), collectedAt: null, receivedAt: null, doneAt: T(8), preliminaryAt: null, resultedAt: T(7) },
        { type: 'CT', orderedAt: T(5), collectedAt: null, receivedAt: null, doneAt: T(4.5), preliminaryAt: null, resultedAt: null },
      ],
      consults: [
        { departmentName: 'Neurosurgery', consultedAt: T(7), seenAt: null, repliedAt: null },
        { departmentName: 'Neurosurgery', consultedAt: T(3), seenAt: null, repliedAt: null },
      ],
    })
    const steps = timeline(t)
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length)
    expect(steps.map((s) => s.label)).toEqual([
      'Registration',
      'Resus / exam room',
      'CT: ordered',
      'CT: scan done',
      'CT: reported',
      'Neurosurgery: consulted',
      'Transfer requested',
      'CT: ordered',
      'CT: scan done',
      'Accepted by facility',
      'Neurosurgery: consulted',
      'RCC / transport arrived',
      'Left ED',
    ])
  })

  it('places the painkiller, the case-management calls and an MRI in the sequence', () => {
    const p = base('p', {
      registrationAt: T(10),
      painkillerAt: T(9.5),
      caseMgmtCalledAt: T(6),
      caseMgmtRepliedAt: T(5),
      investigations: [{ type: 'MRI', orderedAt: T(8), collectedAt: null, receivedAt: null, doneAt: T(7), preliminaryAt: null, resultedAt: T(6.5) }],
    })
    expect(timeline(p).map((s) => s.label)).toEqual([
      'Registration',
      'Painkiller given',
      'MRI: ordered',
      'MRI: scan done',
      'MRI: reported',
      'Case management called',
      'Case management replied',
    ])
  })

  it('is just the registration for an empty case, and adds a Resolved step when no departure was recorded', () => {
    expect(timeline(a).map((s) => s.label)).toEqual(['Registration'])
    const r = base('r', { status: 'RESOLVED', registrationAt: T(5), resolvedAt: T(1) })
    expect(timeline(r).map((s) => s.label)).toEqual(['Registration', 'Resolved (no departure time recorded)'])
  })
})

describe('Adaa', () => {
  it('KPI 1 starts at the door', () => {
    expect(kpi1Minutes(c)).toBe(30) // registration 13 h, triage 12.75, physician 12.5
    const triageFirst = base('t', { registrationAt: T(10), triageAt: T(10.5), physicianAt: T(10) })
    expect(kpi1Minutes(triageFirst)).toBe(30)
    expect(kpi1Minutes(a)).toBeNull()
  })

  it('KPI 2 and 3, and door to disposition, only where the times exist and the case is resolved', () => {
    expect(kpi2Minutes(c)).toBe(150)
    expect(kpi3Minutes(c)).toBe(7 * 60)
    expect(kpi3Minutes(b)).toBeNull() // open
    expect(doorToDispositionHours(c)).toBe(10)
    expect(doorToDispositionHours(a)).toBeNull()
    // Resolved without a departure time: the resolution time is the end.
    const r = base('r', { status: 'RESOLVED', registrationAt: T(5), decisionAt: T(2), resolvedAt: T(1) })
    expect(kpi3Minutes(r)).toBe(60)
    expect(doorToDispositionHours(r)).toBe(4)
    // A reopened case is open: no KPI 3, no door-to-disposition, whatever departedAt says.
    const reopened = base('o', { status: 'OPEN', registrationAt: T(5), decisionAt: T(2), departedAt: T(1) })
    expect(kpi3Minutes(reopened)).toBeNull()
    expect(doorToDispositionHours(reopened)).toBeNull()
  })

  it('KPI 5 uses the same door as KPI 1: a triage-first case is measured from triage', () => {
    const triageFirst = base('t', { status: 'RESOLVED', registrationAt: T(10), triageAt: T(10.5), departedAt: T(6), resolvedAt: T(6) })
    expect(doorToDispositionHours(triageFirst)).toBe(4.5)
    expect(treatedBands([triageFirst]).map((r) => r.value)).toEqual([0, 1, 0, 0, 0, 0, 0])
  })

  it('KPI 8 is door to painkiller, only when one was prescribed, with its own benchmark', () => {
    const given = base('pk', { registrationAt: T(10), triageAt: T(10.5), painkillerPrescribed: 'YES', painkillerAt: T(9) })
    expect(kpi8Minutes(given)).toBe(90) // door is triage at 10.5 h
    expect(kpi8Minutes(base('no', { painkillerPrescribed: 'NO', painkillerAt: T(9) }))).toBeNull()
    expect(kpi8Minutes(base('un', { painkillerPrescribed: 'YES', painkillerAt: null }))).toBeNull()
    expect(benchmark('kpi8', 59)).toBe('world')
    expect(benchmark('kpi8', 60)).toBe('acceptable')
    expect(benchmark('kpi8', 180)).toBe('acceptable')
    expect(benchmark('kpi8', 181)).toBe('improve')
    expect(benchmark('kpi8', 300)).toBe('improve')
    expect(benchmark('kpi8', 301)).toBe('unacceptable')
    expect(benchmark('kpi7', 0.1)).toBeNull()
  })

  it('painkiller bands and pethidine doses read the form\'s statistics block', () => {
    const pk = (id: string, minutes: number, dose: number | null = null) =>
      base(id, {
        registrationAt: T(10),
        painkillerPrescribed: 'YES',
        painkillerAt: T(10 - minutes / 60),
        pethidinePrescribed: dose == null ? 'NO' : 'YES',
        pethidineDoseMg: dose,
      })
    const rows = painkillerBands([pk('a1', 30), pk('a2', 30.5, 50), pk('a3', 60, 100), pk('a4', 61, 100), pk('a5', 180), pk('a6', 181, 150), base('none')])
    expect(rows.map((r) => [r.name, r.value])).toEqual([
      ['≤30 min', 1],
      ['>30 min–1 h', 2],
      ['>1–3 h', 2],
      ['>3 h', 1],
    ])
    // Prescribed with no time, or an off-list dose: in no band, counted in the denominators and flagged.
    const noTime = base('nt', { registrationAt: T(5), painkillerPrescribed: 'YES', painkillerAt: null, pethidinePrescribed: 'YES', pethidineDoseMg: 75 })
    const noDose = base('nd', { registrationAt: T(5), painkillerPrescribed: 'YES', painkillerAt: T(4), pethidinePrescribed: 'YES', pethidineDoseMg: null })
    expect(painkillerBands([noTime, noDose]).map((r) => r.value)).toEqual([0, 1, 0, 0]) // 60 min is (30, 60]
    expect(pethidineDoses([noTime, noDose]).map((r) => r.value)).toEqual([0, 0, 0])
    const summary = adaaSummary([noTime, noDose]).at(-1)!
    expect(summary).toMatchObject({ painkillerYesN: 2, pethidineYesN: 2, kpi8N: 1 })
    const gaps = completeness([noTime, noDose, a], NOW)
    expect(gaps.painkillerNoTime.ids).toEqual(['nt'])
    expect(gaps.pethidineNoDose.ids).toEqual(['nt', 'nd'])
    expect(pethidineDoses([pk('a2', 30.5, 50), pk('a3', 60, 100), pk('a4', 61, 100), pk('a6', 181, 150), base('none')]).map((r) => [r.name, r.value])).toEqual([
      ['50 mg', 1],
      ['100 mg', 2],
      ['150 mg', 1],
    ])
  })

  it('the summary carries KPI 7, KPI 8, UCC referrals and the sickle-cell count', () => {
    const dead = base('x', { status: 'RESOLVED', registrationAt: T(6), departedAt: T(1), resolvedAt: T(1), disposition: 'DECEASED', ctas: 1 })
    const ucc = base('y', { status: 'RESOLVED', registrationAt: T(6), departedAt: T(2), resolvedAt: T(2), disposition: 'REFERRED_UCC', ctas: 5, sickleCellTreatment: 'YES' })
    const given = base('z', { registrationAt: T(4), painkillerPrescribed: 'YES', painkillerAt: T(3), pethidinePrescribed: 'YES', pethidineDoseMg: 100, ctas: 3 })
    const overall = adaaSummary([...ALL, dead, ucc, given]).at(-1)!
    expect(overall.total).toBe(8)
    expect(overall.resolvedN).toBe(5)
    expect(overall.deceasedN).toBe(1)
    // The form divides deaths by TOTAL patients: 8 tracked cases, open ones included.
    expect(overall.deceasedShare).toBeCloseTo(1 / 8, 10)
    expect(overall.painkillerYesN).toBe(1)
    expect(overall.pethidineYesN).toBe(1)
    expect(overall.uccN).toBe(1)
    expect(overall.kpi8N).toBe(1)
    expect(overall.kpi8TotalMin).toBe(60)
    expect(overall.kpi8Med).toBeNull()
    expect(overall.painkiller).toEqual([0, 1, 0, 0])
    expect(overall.pethidine).toEqual([0, 1, 0])
    expect(overall.sickleCellYesN).toBe(1)
    expect(outcomes([dead, ucc]).map((r) => r.name).sort()).toEqual(['Deceased', 'Referred to UCC'])
  })

  it('benchmarks read the definitions sheet, at every threshold', () => {
    expect(benchmark('kpi1', 9.9)).toBe('world')
    expect(benchmark('kpi1', 10)).toBe('acceptable')
    expect(benchmark('kpi1', 20)).toBe('acceptable')
    expect(benchmark('kpi1', 20.1)).toBe('improve')
    expect(benchmark('kpi1', 40)).toBe('improve')
    expect(benchmark('kpi1', 41)).toBe('unacceptable')
    expect(benchmark('kpi2', 29.9)).toBe('world')
    expect(benchmark('kpi2', 30)).toBe('acceptable')
    expect(benchmark('kpi2', 60)).toBe('acceptable')
    expect(benchmark('kpi2', 90)).toBe('improve')
    expect(benchmark('kpi2', 90.5)).toBe('unacceptable')
    expect(benchmark('kpi3', 29.9)).toBe('world')
    expect(benchmark('kpi3', 90)).toBe('acceptable')
    expect(benchmark('kpi3', 130)).toBe('improve')
    expect(benchmark('kpi3', 131)).toBe('unacceptable')
    expect(benchmark('kpi4', 0.2)).toBe('world')
    expect(benchmark('kpi4', 0.33)).toBe('acceptable')
    expect(benchmark('kpi4', 0.5)).toBe('acceptable')
    expect(benchmark('kpi4', 0.75)).toBe('improve')
    expect(benchmark('kpi4', 0.8)).toBe('unacceptable')
    expect(benchmark('kpi5', 0.96)).toBe('world')
    expect(benchmark('kpi5', 0.95)).toBe('acceptable')
    expect(benchmark('kpi5', 0.75)).toBe('acceptable')
    expect(benchmark('kpi5', 0.6)).toBe('improve')
    expect(benchmark('kpi5', 0.59)).toBe('unacceptable')
    expect(benchmark('kpi6', 0.1)).toBeNull()
  })

  it('treated-within bands: 4 h exactly is within, then (min, max]', () => {
    expect(TREATED_BANDS.map((b) => b.name)).toEqual(['Within 4 h', '4–6 h', '6–12 h', '12–24 h', '24–48 h', '48–72 h', '>72 h'])
    expect([4, 4.01, 6, 6.01, 12, 12.01, 24, 24.01, 48, 48.01, 72, 72.01].map(treatedBandIndex)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6])
    const four = base('f', { status: 'RESOLVED', registrationAt: T(4), departedAt: T(0) })
    const six = base('g', { status: 'RESOLVED', registrationAt: T(6), departedAt: T(0) })
    const long = base('h', { status: 'RESOLVED', registrationAt: T(80), departedAt: T(0) })
    expect(treatedBands([four, six, long, a]).map((r) => r.value)).toEqual([1, 1, 0, 0, 0, 0, 1])
    // e 4.5 h and d 6.0 h are both "4–6 h" (Adaa's upper bound is inclusive); c 10 h is 6–12 h.
    expect(treatedBands(ALL).map((r) => r.value)).toEqual([0, 2, 1, 0, 0, 0, 0])
  })

  it('summary rows: one per CTAS always, an unknown row only when needed, then overall', () => {
    const rows = adaaSummary(ALL)
    expect(rows.map((r) => r.ctas)).toEqual([1, 2, 3, 4, 5, 'overall'])
    expect(rows[0]!.total).toBe(0)
    const three = rows.find((r) => r.ctas === 3)!
    expect(three.total).toBe(2) // a and c
    expect(three.kpi1N).toBe(1)
    expect(three.kpi1TotalMin).toBe(30)
    expect(three.kpi1Med).toBeNull() // n<3
    expect(three.treated).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(three.withinFourShare).toBeNull() // n<3
    const overall = rows.at(-1)!
    expect(overall.total).toBe(5)
    expect(overall.kpi2N).toBe(4) // b, c, d, e
    expect(overall.kpi2TotalMin).toBe(6 * 60 + 150 + 60 + 165)
    expect(overall.kpi2Med).toBe((150 + 165) / 2)
    expect(overall.resolvedN).toBe(3)
    expect(overall.damaShare).toBeCloseTo(1 / 3, 10)
    expect(overall.withinFourShare).toBe(0) // c 10 h, d 6 h, e 4.5 h
    expect(overall.nonUrgentShare).toBeCloseTo(2 / 5, 10) // d and e among five with a CTAS
    expect(overall.withCtasN).toBe(5)
    const withUnknown = adaaSummary([...ALL, base('u', { registrationAt: T(1) })])
    expect(withUnknown.map((r) => r.ctas)).toEqual([1, 2, 3, 4, 5, 'unknown', 'overall'])
    expect(withUnknown.at(-1)!.nonUrgentShare).toBeCloseTo(2 / 5, 10) // the unknown case is not in the denominator
  })

  it('unit types and admission-to-unit bands, at the edges', () => {
    expect(unitTypeOf('ICU')).toBe('ICU')
    expect(unitTypeOf('ccu / isolation')).toBe('ICU')
    expect(unitTypeOf('PICU')).toBe('ICU')
    expect(unitTypeOf('MMW')).toBe('Ward')
    expect(unitTypeOf('SDU')).toBe('Ward')
    expect(unitTypeOf(null)).toBeNull()
    expect(ADMISSION_BANDS.map((b) => b.name)).toEqual(['≤30 min', '≤1 h', '1–4 h', '>4 h'])
    const adm = (id: string, hours: number, ward = 'ICU') =>
      base(id, { status: 'RESOLVED', registrationAt: T(10), admOrderAt: T(hours), departedAt: T(0), resolvedAt: T(0), wardCode: ward, disposition: 'ADMITTED' })
    const edges = admissionToUnitBands([adm('h', 0.5), adm('i', 0.5001), adm('j', 1), adm('k', 1.0001), adm('l', 4), adm('m', 4.0001)])
    expect(edges[0]!.bands.map((r) => r.value)).toEqual([1, 2, 2, 1])
    const rows = admissionToUnitBands([...ALL, adm('n', 0.25)])
    expect(rows[0]).toEqual({ unit: 'ICU', bands: [{ name: '≤30 min', value: 1, ids: ['n'] }, { name: '≤1 h', value: 0, ids: [] }, { name: '1–4 h', value: 0, ids: [] }, { name: '>4 h', value: 0, ids: [] }] })
    // c: order 9 h, left 3 h -> 6 h -> >4 h
    expect(rows[1]!.bands.map((r) => r.value)).toEqual([0, 0, 0, 1])
    // A reopened case with an order and an old departure is open: not counted.
    const reopened = base('o', { status: 'OPEN', registrationAt: T(10), admOrderAt: T(3), departedAt: T(2.5), wardCode: 'ICU' })
    expect(admissionToUnitBands([reopened])[0]!.bands.map((r) => r.value)).toEqual([0, 0, 0, 0])
    /**
     * Phase 13 (decision A). The fallback for a resolved case with no departure time used to be
     * the nursing handover; that step is gone, so such a case is in no band at all rather than
     * being banded on a time the app no longer records.
     */
    const noDeparture = base('p', {
      status: 'RESOLVED',
      registrationAt: T(10),
      admOrderAt: T(9),
      departedAt: null,
      resolvedAt: null,
      wardCode: 'ICU',
      disposition: 'ADMITTED',
    })
    expect(admissionToUnitBands([noDeparture])[0]!.bands.map((r) => r.value)).toEqual([0, 0, 0, 0])
  })
})

describe('the working targets', () => {
  it('count units, and a case is within only when all its units are', () => {
    const rows = targets(ALL)
    const byKey = Object.fromEntries(rows.map((r) => [r.name, r]))
    // lab60: c (12.4 -> 11.5 = 54 min, within), d (29 -> 27.5 = 90, missed)
    expect(byKey['Lab resulted within 1 h of order']).toMatchObject({ n: 2, within: 1, ids: ['c', 'd'], withinIds: ['c'], share: null })
    // imaging90 is the OFFICIAL report: c CT ordered 12 h, reported 9 h = 180 min (missed, the
    // preliminary at 90 min does not count); e XR 19.5 -> 18 = 90, within
    expect(byKey['Imaging official report within 90 min of order']).toMatchObject({ n: 2, within: 1, ids: ['c', 'e'], withinIds: ['e'] })
    // consult60: b consulted 25 -> seen 24 = 60 within; c consulted 12 -> replied 11.5 = 30 within
    expect(byKey['Consulted team responded within 1 h']).toMatchObject({ n: 2, within: 2 })
    // decision150: b 360 missed, c 150 within, d 60 within, e 165 missed
    expect(byKey['Decision within 2 h 30 of physician contact']).toMatchObject({ n: 4, within: 2, withinIds: ['c', 'd'] })
    expect(byKey['Decision within 2 h 30 of physician contact']!.share).toBe(0.5)
    // toWard30: c order 9 h -> left 3 h = 360 missed; b has an order but has not left
    expect(byKey['Left ED within 30 min of admission order']).toMatchObject({ n: 1, within: 0, ids: ['c'], withinIds: [] })
  })

  it('a preliminary read inside 90 min with the official report outside it is a miss, and a share appears at n>=3', () => {
    const img = (id: string, prelim: number | null, official: number) =>
      base(id, { investigations: [{ type: 'CT', orderedAt: T(5), collectedAt: null, receivedAt: null, doneAt: T(4.5), preliminaryAt: prelim == null ? null : T(prelim), resultedAt: T(official) }] })
    const rows = targets([img('p', 4, 2), img('q', null, 3.6), img('r', 3.9, 3.5)])
    const imaging = rows.find((r) => r.name.startsWith('Imaging'))!
    expect(imaging).toMatchObject({ n: 3, within: 2, withinIds: ['q', 'r'] })
    expect(imaging.share).toBeCloseTo(2 / 3, 10)
  })

  it('exam to consult, by department, with n counting consults', () => {
    const rows = examToConsult(ALL)
    // b: physician 26 -> consulted 25 = 1 h; c: 12.5 -> 12 = 0.5 h
    expect(rows).toEqual([{ name: 'Internal Medicine', n: 2, ids: ['b', 'c'], med: null }])
    const twice = base('w', { physicianAt: T(6), consults: [{ departmentName: 'Internal Medicine', consultedAt: T(4), seenAt: null, repliedAt: null }, { departmentName: 'Internal Medicine', consultedAt: T(1), seenAt: null, repliedAt: null }] })
    const three = examToConsult([...ALL, twice])[0]!
    expect(three).toMatchObject({ n: 4, ids: ['b', 'c', 'w'] })
    expect(three.med).toBe((1 + 2) / 2) // hours 1, 0.5, 2, 5 -> median of 0.5 1 2 5
  })

  it('turnaround bands per investigation type, with ids deduplicated per band', () => {
    expect(TURNAROUND_BANDS.map((b) => b.name)).toEqual(['≤30 min', '31–60 min', '61–90 min', '91–120 min', '2–4 h', '>4 h'])
    const rows = turnaroundBands(ALL)
    const lab = rows.find((r) => r.type === 'LAB')!
    // order->result: c 54 min (31–60), d 90 min (61–90); received->resulted: c 30 min (≤30)
    expect(lab.orderToResult.map((r) => r.value)).toEqual([0, 1, 1, 0, 0, 0])
    expect(lab.doneToReport.map((r) => r.value)).toEqual([1, 0, 0, 0, 0, 0])
    const ct = rows.find((r) => r.type === 'CT')!
    // c: order 12 -> preliminary 10.5 = 90 min (61–90); done 11 -> preliminary 10.5 = 30 min (≤30)
    expect(ct.orderToResult.map((r) => r.value)).toEqual([0, 0, 1, 0, 0, 0])
    expect(ct.doneToReport.map((r) => r.value)).toEqual([1, 0, 0, 0, 0, 0])
    const xr = rows.find((r) => r.type === 'XR')!
    expect(xr.orderToResult.map((r) => r.value)).toEqual([0, 0, 1, 0, 0, 0])
    expect(rows.map((r) => r.type)).toEqual(['LAB', 'CT', 'US', 'XR', 'MRI'])
    const twoLabs = base('ll', {
      investigations: [
        { type: 'LAB', orderedAt: T(5), collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: T(4.75) },
        { type: 'LAB', orderedAt: T(3), collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: T(2.8) },
      ],
    })
    const band = turnaroundBands([twoLabs]).find((r) => r.type === 'LAB')!.orderToResult[0]!
    expect(band).toEqual({ name: '≤30 min', value: 2, ids: ['ll'] })
  })

  it('turnaround edges: 30 min is ≤30, 30.5 is 31–60, 240 is 2–4 h', () => {
    const lab = (id: string, minutes: number) =>
      base(id, { investigations: [{ type: 'LAB', orderedAt: T(minutes / 60), collectedAt: null, receivedAt: null, doneAt: null, preliminaryAt: null, resultedAt: T(0) }] })
    const rows = turnaroundBands([lab('a1', 30), lab('a2', 30.5), lab('a3', 60), lab('a4', 90), lab('a5', 120), lab('a6', 240), lab('a7', 241)])
    expect(rows[0]!.orderToResult.map((r) => r.value)).toEqual([1, 2, 1, 1, 1, 1])
  })
})

describe('discharge communication', () => {
  it('shares of the answered cases, YES counting as within, guarded below MIN_N', () => {
    const cases = [
      base('c1', { instructionsGiven: 'YES', familyEngagement: 'NO' }),
      base('c2', { instructionsGiven: 'YES', familyEngagement: 'NOT_SURE' }),
      base('c3', { instructionsGiven: 'NO' }),
      base('c4'),
    ]
    const [instructions, family] = communication(cases)
    expect(instructions).toMatchObject({ name: 'Instructions given by doctor', n: 3, within: 2, ids: ['c1', 'c2', 'c3'], withinIds: ['c1', 'c2'] })
    expect(instructions!.share).toBeCloseTo(2 / 3, 10)
    expect(family).toMatchObject({ name: 'Family engaged', n: 2, within: 0, share: null })
  })
})

describe('by CTAS and by area', () => {
  it('always lists CTAS 1..5 in order, then Not recorded, with medians guarded', () => {
    const rows = byCtas([...ALL, base('u', { registrationAt: T(1) })], NOW)
    expect(rows.map((r) => [r.name, r.n])).toEqual([
      ['1', 0],
      ['2', 1],
      ['3', 2],
      ['4', 1],
      ['5', 1],
      ['Not recorded', 1],
    ])
    expect(rows.every((r) => r.med === null)).toBe(true)
    expect(byCtas(ALL, NOW)).toHaveLength(5)
  })

  it('orders areas by size with Not recorded last, and gives a median at n>=3', () => {
    expect(byArea(ALL, NOW).map((r) => [r.name, r.n])).toEqual([
      ['Acute area', 2],
      ['Resuscitation area', 1],
      ['Not recorded', 2],
    ])
    const third = base('x', { registrationAt: T(9), areaName: 'Acute area' })
    const acute = byArea([...ALL, third], NOW)[0]!
    expect(acute).toMatchObject({ name: 'Acute area', n: 3 })
    expect(acute.med).toBe(9) // stays 8, 10, 9
    expect(MIN_N).toBe(3)
  })
})

describe('voided cases are in nothing', () => {
  it('every aggregate over a voided-only list is empty', () => {
    expect(headline([v], NOW)).toMatchObject({ cases: 0, measured: 0, episodes: 0, med: null, longest: null })
    expect(stayBands([v], NOW).every((r) => r.value === 0)).toBe(true)
    expect(longestStays([v], NOW)).toEqual([])
    expect(actionsDocumented([v]).any.value).toBe(0)
    expect(outcomes([v])).toEqual([])
    expect(repeatVisits([v, { ...v, id: 'v2' }])).toEqual([])
    expect(adaaSummary([v]).at(-1)!.total).toBe(0)
    expect(targets([v]).every((r) => r.n === 0)).toBe(true)
    expect(byCtas([v], NOW).every((r) => r.n === 0)).toBe(true)
    expect(byArea([v], NOW)).toEqual([])
  })
})

/**
 * Phase 10: where the time goes, and by payer. Hand-computed from the fixture: door is the
 * earlier of registration and triage, so b's front end runs from T(26.5) not T(26.25); `after`
 * is null for b because it is still open (leaving is endAt, RESOLVED only).
 *   b: front 0.5 h, decision 6 h, after —        c: 0.5, 2.5, 7      (complete)
 *   d: 1, 1, 4 (complete)                        e: 0.25, 2.75, 1.5  (complete)
 *   a: nothing measured; v: voided, ignored.
 * Complete cases c, d, e: sums front 1.75, decision 6.25, after 12.5, total 20.5.
 */
describe('Phase 10: where the time goes, by payer', () => {
  // A voided case that CARRIES times, stages and a payer, so a phase, stage or payer row that
  // forgot live() would show it (the shared `v` carries nothing and proves nothing here).
  const vv = base('vv', {
    status: 'VOIDED',
    registrationAt: T(13),
    departedAt: T(3),
    resolvedAt: T(3),
    triageAt: T(12.75),
    physicianAt: T(12.5),
    decisionAt: T(10),
    stageCodes: ['reg', 'inv', 'adm'],
    payer: 'INSURED',
  })
  const ALL = [a, b, c, d, e, v, vv]

  it('measures the three phases of a case in hours', () => {
    expect(phaseHours(b)).toEqual({ front: 0.5, decision: 6, after: null })
    expect(phaseHours(c)).toEqual({ front: 0.5, decision: 2.5, after: 7 })
    expect(phaseHours(d)).toEqual({ front: 1, decision: 1, after: 4 })
    expect(phaseHours(e)).toEqual({ front: 0.25, decision: 2.75, after: 1.5 })
    expect(phaseHours(a)).toEqual({ front: null, decision: null, after: null })
  })

  it('splits the stay: a median per phase, shares over the complete cases, the longest phase per case', () => {
    const s = phaseSplit(ALL)
    expect(s.completeN).toBe(3)
    expect(s.completeIds).toEqual(['c', 'd', 'e'])
    const [front, decision, after] = s.phases as [typeof s.phases[number], typeof s.phases[number], typeof s.phases[number]]
    expect(front).toMatchObject({ key: 'front', name: 'Front end', n: 4, ids: ['b', 'c', 'd', 'e'], med: 0.5, longestN: 0, longestIds: [] })
    expect(decision).toMatchObject({ key: 'decision', n: 4, ids: ['b', 'c', 'd', 'e'], med: 2.625, longestN: 1, longestIds: ['e'] })
    expect(after).toMatchObject({ key: 'after', n: 3, ids: ['c', 'd', 'e'], med: 4, longestN: 2, longestIds: ['c', 'd'] })
    expect(front.share).toBeCloseTo(1.75 / 20.5, 12)
    expect(decision.share).toBeCloseTo(6.25 / 20.5, 12)
    expect(after.share).toBeCloseTo(12.5 / 20.5, 12)
    expect(front.share! + decision.share! + after.share!).toBeCloseTo(1, 12)
    // Every complete case is charged to exactly one phase.
    expect(s.phases.reduce((n, p) => n + p.longestN, 0)).toBe(s.completeN)
    // The stages under each phase, every case that carries a reason there, zero rows kept.
    expect(front.stages.map((r) => [r.name, r.value])).toEqual([['Registration', 0], ['Triage', 0], ['Resus room', 0], ['Exam room', 0]])
    expect(decision.stages).toEqual([
      { name: 'Investigations', value: 2, ids: ['a', 'e'] },
      { name: 'Referral / consulted team', value: 1, ids: ['b'] },
      { name: 'Disposition decision', value: 0, ids: [] },
    ])
    expect(after.stages).toEqual([
      { name: 'Admission process', value: 2, ids: ['b', 'c'] },
      { name: 'Discharge process', value: 1, ids: ['d'] },
      { name: 'Administrative / coordination', value: 0, ids: [] },
    ])
  })

  it('guards the shares below three complete cases and charges a tie to the earlier phase', () => {
    const two = phaseSplit([a, b, c, d])
    expect(two.completeN).toBe(2)
    expect(two.phases.map((p) => p.share)).toEqual([null, null, null])
    // The medians are guarded per phase, on that phase's own n: front and decision have b, c, d
    // (0.5, 0.5, 1 → 0.5 and 6, 2.5, 1 → 2.5), after has only c and d.
    expect(two.phases.map((p) => p.med)).toEqual([0.5, 2.5, null])
    expect(two.phases.map((p) => [p.longestN, p.longestIds])).toEqual([[0, []], [0, []], [2, ['c', 'd']]])
    const tie = base('t', { status: 'RESOLVED', registrationAt: T(3), physicianAt: T(2), decisionAt: T(1), departedAt: T(0), resolvedAt: T(0) })
    const s = phaseSplit([c, d, e, tie])
    expect(phaseHours(tie)).toEqual({ front: 1, decision: 1, after: 1 })
    // Charged once, to the front end; nowhere else.
    expect(s.phases.map((p) => p.longestIds)).toEqual([['t'], ['e'], ['c', 'd']])
    expect(s.phases.reduce((n, p) => n + p.longestN, 0)).toBe(s.completeN)
    // A tie between decision and after with a shorter front end goes to the decision.
    const later = base('u', { status: 'RESOLVED', registrationAt: T(5), physicianAt: T(4.5), decisionAt: T(2.5), departedAt: T(0.5), resolvedAt: T(0.5) })
    expect(phaseHours(later)).toEqual({ front: 0.5, decision: 2, after: 2 })
    expect(phaseSplit([c, d, later]).phases.map((p) => p.longestIds)).toEqual([[], ['u'], ['c', 'd']])
  })

  it('keeps a voided case out of every phase, stage and payer row', () => {
    const s = phaseSplit([vv])
    expect(s.completeN).toBe(0)
    expect(s.phases.map((p) => [p.n, p.longestN, p.stages.map((r) => r.value)])).toEqual([
      [0, 0, [0, 0, 0, 0]],
      [0, 0, [0, 0, 0]],
      [0, 0, [0, 0, 0]],
    ])
    expect(byPayer([vv], NOW).map((r) => [r.name, r.n])).toEqual([['Government', 0], ['Insured', 0], ['Self-pay', 0]])
  })

  it('groups the cases by payer in a fixed order, with Not recorded last', () => {
    const rows = byPayer(ALL, NOW)
    expect(rows.map((r) => [r.name, r.n, r.ids])).toEqual([
      ['Government', 2, ['c', 'd']],
      ['Insured', 1, ['b']],
      ['Self-pay', 1, ['e']],
      ['Not recorded', 1, ['a']],
    ])
    // Every group is below MIN_N here, so no median is a number.
    expect(rows.map((r) => r.med)).toEqual([null, null, null, null])
    expect(byPayer([c, d, e], NOW).map((r) => r.name)).toEqual(['Government', 'Insured', 'Self-pay'])
  })
})

/**
 * Phase 11: the stay split by outcome. Every case below is resolved with all three phases
 * measured unless it says otherwise, so each group's figures can be summed by hand (hours are
 * front end, decision, after the decision):
 *
 *   Admitted      A1 (1, 1, 6)  A2 (0.5, 2, 8)  c (0.5, 2.5, 7)             sums 2, 5.5, 21     total 28.5
 *   Discharged    d DAMA (1, 1, 4)  e (0.25, 2.75, 1.5)  D3 (0.5, 3, 0.5)   sums 1.75, 6.75, 6  total 14.5
 *   Transferred   T1 (1, 1, 1)
 *   Other         O1 deceased (2, 1, 1)  O2 referred to UCC (1, 2, 3)
 *   None          N1, resolved with no disposition (1, 1, 2): in the overall bar, in no group
 *
 * Not complete, so in nothing: b (open), a (nothing measured), A3 (admitted, no decision time),
 * vv (voided, although it carries every time).
 */
describe('Phase 11: the stay split by outcome', () => {
  const resolved = (id: string, reg: number, physician: number, decision: number, left: number, disposition: string | null) =>
    base(id, {
      status: 'RESOLVED',
      registrationAt: T(reg),
      physicianAt: T(physician),
      decisionAt: T(decision),
      departedAt: T(left),
      resolvedAt: T(left),
      disposition,
    })
  const A1 = resolved('A1', 10, 9, 8, 2, 'ADMITTED')
  const A2 = resolved('A2', 12, 11.5, 9.5, 1.5, 'ADMITTED')
  const A3 = base('A3', { status: 'RESOLVED', registrationAt: T(9), physicianAt: T(8), departedAt: T(1), resolvedAt: T(1), disposition: 'ADMITTED' })
  const D3 = resolved('D3', 6, 5.5, 2.5, 2, 'DISCHARGED_HOME')
  const T1 = resolved('T1', 5, 4, 3, 2, 'TRANSFERRED')
  const O1 = resolved('O1', 6, 4, 3, 2, 'DECEASED')
  const O2 = resolved('O2', 7, 6, 4, 1, 'REFERRED_UCC')
  const N1 = resolved('N1', 5, 4, 3, 1, null)
  const vv = base('vv', {
    status: 'VOIDED',
    registrationAt: T(13),
    physicianAt: T(12.5),
    decisionAt: T(10),
    departedAt: T(3),
    resolvedAt: T(3),
    disposition: 'ADMITTED',
  })
  const CASES = [a, b, c, d, e, v, vv, A1, A2, A3, D3, T1, O1, O2, N1]
  const rows = phaseSplitByOutcome(CASES)
  const row = (key: string) => rows.find((r) => r.key === key)!

  it('files every disposition under one of the four groups, and a missing one under none', () => {
    expect(OUTCOME_GROUPS.map((g) => [g.key, g.name])).toEqual([
      ['admitted', 'Admitted'],
      ['discharged', 'Discharged (home and DAMA)'],
      ['transferred', 'Transferred'],
      ['other', 'Other outcomes'],
    ])
    expect(outcomeGroupOf('ADMITTED')).toBe('admitted')
    expect(outcomeGroupOf('DISCHARGED_HOME')).toBe('discharged')
    expect(outcomeGroupOf('DISCHARGED_DAMA')).toBe('discharged')
    expect(outcomeGroupOf('TRANSFERRED')).toBe('transferred')
    for (const other of ['DECEASED', 'REFERRED_UCC', 'LEFT_WITHOUT_BEING_SEEN', 'OTHER']) {
      expect(outcomeGroupOf(other), other).toBe('other')
    }
    expect(outcomeGroupOf(null)).toBeNull()
  })

  it('is the overall bar, then the four groups, in a fixed order', () => {
    expect(rows.map((r) => [r.key, r.name])).toEqual([
      ['all', 'All outcomes'],
      ['admitted', 'Admitted'],
      ['discharged', 'Discharged (home and DAMA)'],
      ['transferred', 'Transferred'],
      ['other', 'Other outcomes'],
    ])
  })

  it('draws the overall bar over the complete cases only', () => {
    const all = row('all').split
    expect(all.completeIds).toEqual(['c', 'd', 'e', 'A1', 'A2', 'D3', 'T1', 'O1', 'O2', 'N1'])
    // Sums over the ten: front 2 + 1.75 + 1 + 2 + 1 + 1 = 8.75; decision 5.5 + 6.75 + 1 + 1 + 2 + 1
    // = 17.25; after 21 + 6 + 1 + 1 + 3 + 2 = 34; total 60.
    const [front, decision, after] = all.phases
    expect(front!.share).toBeCloseTo(8.75 / 60, 12)
    expect(decision!.share).toBeCloseTo(17.25 / 60, 12)
    expect(after!.share).toBeCloseTo(34 / 60, 12)
    // The shares are the ones phaseSplit gives over every case, because a share only ever counts
    // the complete ones.
    const whole = phaseSplit(CASES)
    expect(all.phases.map((p) => p.share)).toEqual(whole.phases.map((p) => p.share))
    // The medians are over the same ten, not over each phase's own measured cases: the open case b
    // and the half-measured A3 are in phaseSplit's medians and not in these.
    expect(whole.phases.map((p) => p.n)).toEqual([12, 11, 10])
    expect(all.phases.map((p) => p.n)).toEqual([10, 10, 10])
    // front 0.25 0.5 0.5 0.5 1 1 1 1 1 2 -> 1; decision 1 1 1 1 1 2 2 2.5 2.75 3 -> 1.5;
    // after 0.5 1 1 1.5 2 3 4 6 7 8 -> 2.5.
    expect(all.phases.map((p) => p.med)).toEqual([1, 1.5, 2.5])
  })

  it('splits the admitted and the discharged, whose stays go to different phases', () => {
    const admitted = row('admitted').split
    expect(admitted.completeIds).toEqual(['c', 'A1', 'A2'])
    expect(admitted.phases.map((p) => p.share)).toEqual([2 / 28.5, 5.5 / 28.5, 21 / 28.5])
    expect(admitted.phases.map((p) => p.med)).toEqual([0.5, 2, 7])
    const discharged = row('discharged').split
    expect(discharged.completeIds).toEqual(['d', 'e', 'D3'])
    expect(discharged.phases.map((p) => p.share)).toEqual([1.75 / 14.5, 6.75 / 14.5, 6 / 14.5])
    expect(discharged.phases.map((p) => p.med)).toEqual([0.5, 2.75, 1.5])
    // Admitted patients spend most of the stay after the decision; the discharged, deciding.
    expect(admitted.phases[2]!.share!).toBeGreaterThan(0.5)
    expect(discharged.phases[1]!.share!).toBeGreaterThan(discharged.phases[2]!.share!)
  })

  it('guards a group under three complete cases, and puts a case with no disposition in none', () => {
    expect(row('transferred').split.completeIds).toEqual(['T1'])
    expect(row('other').split.completeIds).toEqual(['O1', 'O2'])
    for (const key of ['transferred', 'other']) {
      expect(row(key).split.phases.map((p) => [p.share, p.med]), key).toEqual([
        [null, null],
        [null, null],
        [null, null],
      ])
    }
    const grouped = rows.filter((r) => r.key !== 'all').flatMap((r) => r.split.completeIds)
    expect(grouped).not.toContain('N1')
    expect([...grouped].sort()).toEqual(row('all').split.completeIds.filter((id) => id !== 'N1').sort())
  })

  it('leaves out the voided, the open and the half-measured', () => {
    const everywhere = rows.flatMap((r) => r.split.completeIds)
    for (const id of ['vv', 'v', 'b', 'a', 'A3']) expect(everywhere, id).not.toContain(id)
    expect(phaseSplitByOutcome([vv, b, A3]).every((r) => r.split.completeN === 0)).toBe(true)
  })
})
