import { describe, expect, it } from 'vitest'
import {
  ADMISSION_BANDS,
  actionsDocumented,
  adaaSummary,
  admissionToUnitBands,
  benchmark,
  byArea,
  byCtas,
  completeness,
  doorToDispositionHours,
  examToConsult,
  headline,
  hoursBetween,
  isOutOfOrder,
  kpi1Minutes,
  kpi2Minutes,
  kpi3Minutes,
  longestStays,
  minutesBetween,
  outcomes,
  previousRange,
  repeatVisits,
  STAY_BANDS,
  stayBands,
  targets,
  timeline,
  TREATED_BANDS,
  treatedBands,
  turnaroundBands,
  unitTypeOf,
  type KpiCase,
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
    physicianAt: null,
    decisionAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    medAdminInformedAt: null,
    disposition: null,
    wardCode: null,
    ctas: null,
    areaName: null,
    stageNames: [],
    updatesCount: 0,
    lastUpdateAt: null,
    consults: [],
    investigations: [],
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
const a = base('a', { ctas: 3, areaName: 'Acute area', stageNames: ['Investigations'] })
const b = base('b', {
  registrationAt: T(26.5),
  ctas: 2,
  areaName: 'Resuscitation area',
  stageNames: ['Referral / consulted team', 'Admission process'],
  medAdminInformedAt: T(2),
  updatesCount: 1,
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
  disposition: 'ADMITTED',
  wardCode: 'MMW',
  triageAt: T(12.75),
  physicianAt: T(12.5),
  decisionAt: T(10),
  admOrderAt: T(9),
  bedRequestedAt: T(8),
  bedAssignedAt: T(4),
  handoverAt: T(3.5),
  updatesCount: 2,
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
  investigations: [{ type: 'XR', orderedAt: T(19.5), collectedAt: null, receivedAt: null, doneAt: T(19), preliminaryAt: null, resultedAt: T(18) }],
})
const v = base('v', { status: 'VOIDED', registrationAt: T(40) })
const ALL = [a, b, c, d, e, v]

describe('durations', () => {
  it('are hours or minutes, null when missing or impossible', () => {
    expect(hoursBetween(T(2), T(1))).toBe(1)
    expect(minutesBetween(T(2), T(1.5))).toBe(30)
    expect(hoursBetween(T(1), T(2))).toBeNull()
    expect(hoursBetween(null, T(1))).toBeNull()
    expect(hoursBetween(T(1), null)).toBeNull()
  })
})

describe('the weekly deck', () => {
  it('headline: cases, episodes, median, mean, range, 10 h and 12 h shares, longest', () => {
    const h = headline(ALL, NOW)
    expect(h.cases).toBe(5)
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

  it('headline below n<3 keeps the counts and the longest but no median, mean or range', () => {
    const h = headline([a, b], NOW)
    expect(h.cases).toBe(2)
    expect(h.med).toBeNull()
    expect(h.mean).toBeNull()
    expect(h.min).toBeNull()
    expect(h.longest?.id).toBe('b')
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

  it('previousRange is the window of the same length just before, and empty for all', () => {
    // range 7 d: window is (7 d, 14 d] before now. Everything here is younger than 7 d.
    expect(previousRange(ALL, '7', NOW)).toEqual([])
    const old = base('old', { registrationAt: T(24 * 10) })
    expect(previousRange([...ALL, old], '7', NOW).map((c) => c.id)).toEqual(['old'])
    expect(previousRange([...ALL, old], '30', NOW)).toEqual([])
    expect(previousRange([...ALL, old], 'all', NOW)).toEqual([])
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

  it('actions documented: b (update, escalation, fax) and c (updates, fax); a, d, e none', () => {
    const acts = actionsDocumented(ALL)
    expect(acts.any).toEqual({ name: 'Action documented', value: 2, ids: ['b', 'c'] })
    expect(acts.none.ids).toEqual(['a', 'd', 'e'])
    expect(acts.byKind.map((r) => [r.name, r.value])).toEqual([
      ['Update written', 2],
      ['Medical admin informed', 1],
      ['Bed requested (fax)', 2],
      ['Transfer requested', 0],
    ])
  })

  it('outcomes: resolved by disposition label, largest first, then the open ones', () => {
    expect(outcomes(ALL).map((r) => [r.name, r.value])).toEqual([
      ['Admitted', 1],
      ['Discharged DAMA', 1],
      ['Discharged home', 1],
      ['Still open', 2],
    ])
  })

  it('completeness flags the four data-quality rows', () => {
    const quiet = base('q', { registrationAt: T(13), stageNames: ['Triage'] }) // open, no update, 13 h
    const noDispo = base('n', { status: 'RESOLVED', registrationAt: T(10), resolvedAt: T(1), stageNames: ['Triage'] })
    const swapped = base('s', { physicianAt: T(1), decisionAt: T(2), stageNames: ['Triage'] })
    const rows = completeness([...ALL, quiet, noDispo, swapped], NOW)
    expect(rows.noReason.ids).toEqual([]) // every fixture case carries a stage
    expect(rows.openQuiet12h.ids).toEqual(['q']) // a is 8 h old with no update; b was updated 2 h ago
    expect(rows.resolvedNoDisposition.ids).toEqual(['n'])
    expect(rows.outOfOrder.ids).toEqual(['s'])
    expect(isOutOfOrder(c)).toBe(false)
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
      'Nursing handover done',
      'Left ED',
    ])
    expect(steps[0]!.fromPrevious).toBeNull()
    expect(steps[1]!.fromPrevious).toBeCloseTo(0.25, 10)
    expect(steps.at(-1)!.fromPrevious).toBeCloseTo(0.5, 10)
    // Ties keep insertion order: milestones, then investigations in array order (LAB before
    // CT), then consults, then the admission chain. Three steps sit at exactly 12 h.
    const atTwelve = steps.filter((s) => s.at.getTime() === T(12).getTime()).map((s) => s.label)
    expect(atTwelve).toEqual(['Lab: received by lab', 'CT: ordered', 'Internal Medicine: consulted'])
    // And at 9 h the CT report (an investigation) precedes the admission order (the chain).
    const atNine = steps.filter((s) => s.at.getTime() === T(9).getTime()).map((s) => s.label)
    expect(atNine).toEqual(['CT: reported', 'Admission order written'])
  })

  it('is just the registration for an empty case', () => {
    expect(timeline(a).map((s) => s.label)).toEqual(['Registration'])
  })
})

describe('Adaa', () => {
  it('KPI 1 starts at the earlier of registration and triage', () => {
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
  })

  it('benchmarks read the definitions sheet', () => {
    expect(benchmark('kpi1', 9.9)).toBe('world')
    expect(benchmark('kpi1', 20)).toBe('acceptable')
    expect(benchmark('kpi1', 20.1)).toBe('improve')
    expect(benchmark('kpi1', 41)).toBe('unacceptable')
    expect(benchmark('kpi2', 30)).toBe('acceptable')
    expect(benchmark('kpi3', 130)).toBe('improve')
    expect(benchmark('kpi4', 0.2)).toBe('world')
    expect(benchmark('kpi4', 0.8)).toBe('unacceptable')
    expect(benchmark('kpi5', 0.96)).toBe('world')
    expect(benchmark('kpi5', 0.95)).toBe('acceptable')
    expect(benchmark('kpi5', 0.6)).toBe('improve')
    expect(benchmark('kpi5', 0.59)).toBe('unacceptable')
    expect(benchmark('kpi6', 0.1)).toBeNull()
  })

  it('treated-within bands: 4 h exactly is within, then (min, max]', () => {
    expect(TREATED_BANDS.map((b) => b.name)).toEqual(['Within 4 h', '4–6 h', '6–12 h', '12–24 h', '24–48 h', '48–72 h', '>72 h'])
    const four = base('f', { status: 'RESOLVED', registrationAt: T(4), departedAt: T(0) })
    const six = base('g', { status: 'RESOLVED', registrationAt: T(6), departedAt: T(0) })
    const long = base('h', { status: 'RESOLVED', registrationAt: T(80), departedAt: T(0) })
    expect(treatedBands([four, six, long, a]).map((r) => r.value)).toEqual([1, 1, 0, 0, 0, 0, 1])
    // e 4.5 h and d 6.0 h are both "4–6 h" (Adaa's upper bound is inclusive); c 10 h is 6–12 h.
    expect(treatedBands(ALL).map((r) => r.value)).toEqual([0, 2, 1, 0, 0, 0, 0])
  })

  it('summary rows: one per CTAS, an unknown row only when needed, then overall', () => {
    const rows = adaaSummary(ALL)
    expect(rows.map((r) => r.ctas)).toEqual([1, 2, 3, 4, 5, 'overall'])
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

  it('unit types and admission-to-unit bands', () => {
    expect(unitTypeOf('ICU')).toBe('ICU')
    expect(unitTypeOf('ccu / isolation')).toBe('ICU')
    expect(unitTypeOf('PICU')).toBe('ICU')
    expect(unitTypeOf('MMW')).toBe('Ward')
    expect(unitTypeOf('SDU')).toBe('Ward')
    expect(unitTypeOf(null)).toBeNull()
    expect(ADMISSION_BANDS.map((b) => b.name)).toEqual(['≤30 min', '≤1 h', '1–4 h', '>4 h'])
    const icu = base('i', { status: 'RESOLVED', registrationAt: T(10), admOrderAt: T(3), departedAt: T(2.5), wardCode: 'ICU', disposition: 'ADMITTED' })
    const rows = admissionToUnitBands([...ALL, icu])
    expect(rows[0]).toEqual({ unit: 'ICU', bands: [{ name: '≤30 min', value: 1, ids: ['i'] }, { name: '≤1 h', value: 0, ids: [] }, { name: '1–4 h', value: 0, ids: [] }, { name: '>4 h', value: 0, ids: [] }] })
    // c: order 9 h, left 3 h -> 6 h -> >4 h
    expect(rows[1]!.bands.map((r) => r.value)).toEqual([0, 0, 0, 1])
  })
})

describe('the working targets', () => {
  it('count units, and a case is within only when all its units are', () => {
    const rows = targets(ALL)
    const byKey = Object.fromEntries(rows.map((r) => [r.name, r]))
    // lab60: c (12.4 -> 11.5 = 54 min, within), d (29 -> 27.5 = 90, missed)
    expect(byKey['Lab resulted within 1 h of order']).toMatchObject({ n: 2, within: 1, ids: ['c', 'd'], withinIds: ['c'], share: null })
    // imaging90: c CT ordered 12 h, preliminary 10.5 -> 90 min exactly, within; e XR 19.5 -> 18 = 90, within
    expect(byKey['Imaging reported within 90 min of order']).toMatchObject({ n: 2, within: 2, withinIds: ['c', 'e'] })
    // consult60: b consulted 25 -> seen 24 = 60 within; c consulted 12 -> replied 11.5 = 30 within
    expect(byKey['Consulted team responded within 1 h']).toMatchObject({ n: 2, within: 2 })
    // decision150: b 360 missed, c 150 within, d 60 within, e 165 missed
    expect(byKey['Decision within 2 h 30 of physician contact']).toMatchObject({ n: 4, within: 2, withinIds: ['c', 'd'] })
    expect(byKey['Decision within 2 h 30 of physician contact']!.share).toBe(0.5)
    // toWard30: c order 9 h -> left 3 h = 360 missed; b has an order but has not left
    expect(byKey['Left ED within 30 min of admission order']).toMatchObject({ n: 1, within: 0, ids: ['c'], withinIds: [] })
  })

  it('exam to consult, by department', () => {
    const rows = examToConsult(ALL)
    // b: physician 26 -> consulted 25 = 1 h; c: 12.5 -> 12 = 0.5 h
    expect(rows).toEqual([{ name: 'Internal Medicine', n: 2, ids: ['b', 'c'], med: null }])
  })

  it('turnaround bands per investigation type', () => {
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
  })
})

describe('by CTAS and by area', () => {
  it('orders CTAS 1..5 with Not recorded last and medians guarded', () => {
    const rows = byCtas([...ALL, base('u', { registrationAt: T(1) })], NOW)
    expect(rows.map((r) => [r.name, r.n])).toEqual([
      ['2', 1],
      ['3', 2],
      ['4', 1],
      ['5', 1],
      ['Not recorded', 1],
    ])
    expect(rows.every((r) => r.med === null)).toBe(true)
  })

  it('orders areas by size with Not recorded last', () => {
    expect(byArea(ALL, NOW).map((r) => [r.name, r.n])).toEqual([
      ['Acute area', 2],
      ['Resuscitation area', 1],
      ['Not recorded', 2],
    ])
  })
})
