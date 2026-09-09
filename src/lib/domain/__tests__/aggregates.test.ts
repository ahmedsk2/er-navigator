import { describe, expect, it } from 'vitest'
import {
  admissionStats,
  byDepartment,
  byDisposition,
  byPrimaryReason,
  byShift,
  byStage,
  byWeek,
  byWeekday,
  consultRows,
  dashboard,
  inRange,
  investigationRows,
  otherQueue,
  riyadhParts,
  thresholdTable,
  tiles,
  weekKey,
} from '../aggregates'
import { FIXTURE, NOW } from './aggregates.fixture'

const row = <T extends { name: string }>(rows: T[], name: string) => rows.find((r) => r.name === name)

describe('range filter', () => {
  it('30 days keeps C1-C8, C11, C12 and drops the voided and the 40-day-old case', () => {
    expect(inRange(FIXTURE, '30', NOW).map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C11', 'C12'])
  })
  it('7 days also drops C8 (10 days old)', () => {
    expect(inRange(FIXTURE, '7', NOW).map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C11', 'C12'])
  })
  it('all keeps everything but the voided case', () => {
    expect(inRange(FIXTURE, 'all', NOW)).toHaveLength(11)
  })
})

describe('Riyadh calendar', () => {
  it('NOW is Tuesday 15:00 in Riyadh', () => expect(riyadhParts(NOW)).toEqual({ y: 2026, m: 9, day: 8, weekday: 2 }))
  it('week key is the Sunday that starts the Riyadh week', () => {
    expect(weekKey(NOW)).toBe('2026-09-06')
    expect(weekKey(new Date('2026-09-05T10:00:00Z'))).toBe('2026-08-30') // Saturday 13:00 Riyadh
    expect(weekKey(new Date('2026-09-05T21:30:00Z'))).toBe('2026-09-06') // Sunday 00:30 Riyadh
  })
})

describe('30-day dashboard, hand-computed', () => {
  const cases = inRange(FIXTURE, '30', NOW)

  it('tiles: 5 open, 3 open past 6h, median LOS of 5 resolved (2,6,7,8,10) = 7', () => {
    expect(tiles(cases, NOW)).toEqual({ openNow: 5, openPast6: 3, resolvedN: 5, medianLos: 7 })
  })

  it('threshold table', () => {
    const t = thresholdTable(cases, NOW).map((r) => [r.threshold, r.openNow, r.allCases])
    expect(t).toEqual([
      [4, 4, 8],
      [6, 3, 7],
      [12, 2, 2],
      [24, 1, 1],
    ])
    expect(thresholdTable(cases, NOW)[0]!.openIds).toEqual(['C2', 'C3', 'C4', 'C11'])
  })

  it('primary reason: "No bed available on accepting ward" leads with 2', () => {
    const r = byPrimaryReason(cases)
    expect(r[0]).toMatchObject({ name: 'No bed available on accepting ward', value: 2, ids: ['C1', 'C5'] })
    expect(r).toHaveLength(9)
  })

  it('stage counts', () => {
    const s = byStage(cases)
    expect(row(s, 'Admission process')?.value).toBe(2)
    expect(row(s, 'Referral / consulted team')?.value).toBe(2)
    expect(row(s, 'Investigations')?.value).toBe(2)
    expect(row(s, 'Triage')?.value).toBe(2)
    expect(row(s, 'Discharge process')?.value).toBe(2)
    expect(row(s, 'Administrative / coordination')?.value).toBe(1)
    expect(row(s, 'Resus room')).toBeUndefined()
  })

  it('departments: MROD 2, ICU 1, General Surgery 1, Urology 1', () => {
    const d = byDepartment(cases)
    expect(d[0]).toMatchObject({ name: 'MROD', value: 2 })
    expect(d.map((x) => x.value)).toEqual([2, 1, 1, 1])
  })

  it('dispositions of resolved cases', () => {
    const d = byDisposition(cases)
    expect(row(d, 'DISCHARGED_HOME')?.value).toBe(2)
    expect(row(d, 'ADMITTED')?.value).toBe(1)
    expect(row(d, 'DISCHARGED_DAMA')?.value).toBe(1)
    expect(row(d, 'LEFT_WITHOUT_BEING_SEEN')?.value).toBe(1)
    expect(row(d, 'TRANSFERRED')).toBeUndefined()
  })

  it('by shift with medians (MORNING 2,3,7,8,25 -> 7; EVENING 7,10 -> 8.5 with n<3; NIGHT 4,6,13 -> 6)', () => {
    const s = byShift(cases, NOW)
    expect(row(s, 'MORNING')).toMatchObject({ n: 5, med: 7 })
    expect(row(s, 'EVENING')).toMatchObject({ n: 2, med: 8.5 })
    expect(row(s, 'NIGHT')).toMatchObject({ n: 3, med: 6 })
  })

  it('by weekday in Riyadh: Tue 4, Mon 3, Sun 1, Sat 2', () => {
    const w = byWeekday(cases)
    expect(row(w, 'Tue')?.value).toBe(4)
    expect(row(w, 'Mon')?.value).toBe(3)
    expect(row(w, 'Sun')?.value).toBe(1)
    expect(row(w, 'Sat')?.value).toBe(2)
    expect(w.map((x) => x.name)).toEqual(['Sun', 'Mon', 'Tue', 'Sat'])
  })

  it('weeks: Aug 23 (1), Aug 30 (1), Sep 6 (8, median 7.5, two over 12h)', () => {
    const w = byWeek(cases, NOW)
    expect(w.map((x) => [x.weekStart, x.cases])).toEqual([
      ['2026-08-23', 1],
      ['2026-08-30', 1],
      ['2026-09-06', 8],
    ])
    expect(w[2]).toMatchObject({ med: 7.5, over12: 2 })
  })

  it('consulted team response: GS (4) > ICU (2, reply null) > MROD (1.5) > Urology (out of order, both null)', () => {
    const r = consultRows(cases)
    expect(r.map((x) => x.name)).toEqual(['General Surgery', 'ICU', 'MROD', 'Urology'])
    expect(row(r, 'MROD')).toMatchObject({ n: 2, toSeen: 1, toReply: 1.5 })
    expect(row(r, 'ICU')).toMatchObject({ n: 1, toSeen: 2, toReply: null })
    expect(row(r, 'General Surgery')).toMatchObject({ n: 1, toSeen: 3, toReply: 4 })
    expect(row(r, 'Urology')).toMatchObject({ n: 1, toSeen: null, toReply: null })
  })

  it('investigation turnaround: LAB order->collected 1, ->resulted 4; CT order->done 2, ->reported 5', () => {
    const r = investigationRows(cases)
    expect(r.map((x) => x.type)).toEqual(['LAB', 'CT'])
    expect(row(r, 'Lab')).toMatchObject({ n: 1, toMid: 1, toDone: 4 })
    expect(row(r, 'CT')).toMatchObject({ n: 1, toMid: 2, toDone: 5 })
  })

  it('admission chain: n 1, order->bed 4, request->bed 3.5, bed->left 1', () => {
    expect(admissionStats(cases)).toEqual({ n: 1, ids: ['C5'], orderToBed: 4, requestToBed: 3.5, bedToLeave: 1 })
  })

  it('Other review queue has the one Other text', () => {
    expect(otherQueue(cases)).toEqual([{ id: 'C8', mrn: '100008', stageName: 'Discharge process', text: 'Waiting for social worker' }])
  })
})

/**
 * Phase 8, Slice D. `src/lib/domain/kpi.ts` is written in parallel and takes a `KpiCase`, "a
 * structural subset of `CaseForStats`". The shape below is that contract, field for field, from
 * `docs/specs/phase8-reports.md` — restated here rather than imported, because this branch was
 * cut before the module landed and the loader's job is to satisfy the contract whether or not
 * the module is present. A field dropped from `CaseForStats`, or handed back with the wrong
 * type, is a compile error in this file.
 */
type KpiConsultContract = {
  departmentName: string
  consultedAt: Date | null
  seenAt: Date | null
  repliedAt: Date | null
}
type KpiInvestigationContract = {
  type: 'LAB' | 'CT' | 'US' | 'XR'
  orderedAt: Date | null
  collectedAt: Date | null
  receivedAt: Date | null
  doneAt: Date | null
  preliminaryAt: Date | null
  resultedAt: Date | null
}
type KpiCaseContract = {
  id: string
  mrn: string
  status: 'OPEN' | 'RESOLVED' | 'VOIDED'
  registrationAt: Date
  triageAt: Date | null
  roomAt: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  departedAt: Date | null
  resolvedAt: Date | null
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
  stageNames: ReadonlyArray<string>
  updatesCount: number
  lastUpdateAt: Date | null
  consults: ReadonlyArray<KpiConsultContract>
  investigations: ReadonlyArray<KpiInvestigationContract>
}

describe('CaseForStats satisfies the KpiCase contract', () => {
  it('every case in the fixture is usable as a KpiCase', () => {
    const asKpi: KpiCaseContract[] = FIXTURE
    expect(asKpi).toHaveLength(FIXTURE.length)
  })

  it('carries the Phase 8 collection fields and the update counters', () => {
    const c1 = FIXTURE.find((c) => c.id === 'C1')!
    expect(c1.ctas).toBe(3)
    expect(c1.areaName).toBe('Rapid assessment zone')
    // Untouched by every Phase 4 aggregate, so the hand-computed answers above are unchanged.
    expect(FIXTURE.every((c) => typeof c.updatesCount === 'number')).toBe(true)
    expect(FIXTURE.filter((c) => c.ctas != null).map((c) => c.id)).toEqual(['C1', 'C5', 'C6'])
  })
})

describe('all-time dashboard adds C9', () => {
  it('median LOS over six resolved (2,6,7,8,9,10) = 7.5; Resus and TRANSFERRED appear', () => {
    const d = dashboard(FIXTURE, 'all', NOW)
    expect(d.total).toBe(11)
    expect(d.inRange).toBe(11)
    expect(d.tiles.medianLos).toBe(7.5)
    expect(row(d.byStage, 'Resus room')?.value).toBe(1)
    expect(row(d.byDispo, 'TRANSFERRED')?.value).toBe(1)
  })

  it('the page helper caps the primary-reason chart at 8 rows (prototype), the aggregate itself does not', () => {
    expect(dashboard(FIXTURE, 'all', NOW).byPrimary).toHaveLength(8)
    expect(byPrimaryReason(inRange(FIXTURE, 'all', NOW))).toHaveLength(10)
  })
})

/**
 * Phase 8: `dashboard().kpi`. Every figure is `kpi.ts`'s, already tested there against its own
 * fixture; what is checked here is that this layer hands it the right case list — the 30-day
 * window for the panels, the unfiltered list for `previousRange` — and that the two shares and
 * the two derived lists (the six completeness rows, the "missed this target" ids) are right.
 *
 * The ten cases in the 30-day window have stays 3, 7, 13, 25, 8, 10, 6, 7, 2, 4 hours
 * (C1, C2, C3, C4, C5, C6, C7, C8, C11, C12), all hand-computed in the sections above.
 */
describe('Phase 8 panels', () => {
  const k = dashboard(FIXTURE, '30', NOW).kpi

  it('the headline is the ten in-range cases: median 7 h, mean 8.5 h, 2 to 25 h', () => {
    expect(k.headline).toMatchObject({ cases: 10, measured: 10, episodes: 10, med: 7, mean: 8.5, min: 2, max: 25 })
    // 13, 25 and 10 are at or past 10 h; 13 and 25 are at or past 12 h.
    expect(k.headline.atLeast10).toBe(3)
    expect(k.headline.atLeast12).toBe(2)
    expect(k.headline.longest).toEqual({ id: 'C4', mrn: '100004', hours: 25 })
    expect(k.atLeast10Share).toBe(0.3)
    expect(k.atLeast12Share).toBe(0.2)
  })

  it('the previous 30 days is C9 alone, measured to the end of its own period and not to now', () => {
    // C9 registered 960 h ago (40 days): outside this window, inside the one before it. It left
    // 9 h later, so its stay is 9 h whichever instant the period is measured to.
    expect(k.previous?.headline.cases).toBe(1)
    expect(k.previous?.headline.longest).toEqual({ id: 'C9', mrn: '100009', hours: 9 })
    expect(k.previous?.asOf).toEqual(new Date(NOW.getTime() - 30 * 864e5))
    // 'all' has no period before it, so no delta is offered.
    expect(dashboard(FIXTURE, 'all', NOW).kpi.previous).toBeNull()
  })

  it('stay bands cover every in-range case exactly once', () => {
    expect(k.stayBands.map((r) => [r.name, r.value])).toEqual([
      ['<6 h', 3], // 3, 4, 2
      ['6–<8 h', 3], // 7, 6, 7
      ['8–<10 h', 1], // 8
      ['10–<12 h', 1], // 10
      ['12–<24 h', 1], // 13
      ['24+ h', 1], // 25
    ])
    expect(k.stayBands.reduce((n, r) => n + r.value, 0)).toBe(10)
  })

  it('longest stays are ranked, and a tie on hours breaks by MRN', () => {
    expect(k.longest.map((r) => [r.id, r.hours])).toEqual([
      ['C4', 25],
      ['C3', 13],
      ['C6', 10],
      ['C5', 8],
      ['C2', 7],
      ['C8', 7],
      ['C7', 6],
      ['C11', 4],
      ['C1', 3],
      ['C12', 2],
    ])
  })

  it('actions, outcomes and repeat visits', () => {
    // Only C5 has a documented action in this fixture: the fax that requested its bed.
    expect(k.actions.any.ids).toEqual(['C5'])
    expect(k.actions.none.ids).toHaveLength(9)
    expect(k.actions.byKind.map((r) => [r.name, r.value])).toEqual([
      ['Update written', 0],
      ['Medical admin informed', 0],
      ['Bed requested (fax)', 1],
      ['Transfer requested', 0],
    ])
    expect(k.outcomes.map((r) => [r.name, r.value])).toEqual([
      ['Discharged home', 2],
      ['Admitted', 1],
      ['Discharged DAMA', 1],
      ['Left without being seen', 1],
      ['Still open', 5],
    ])
    expect(k.repeats).toEqual([]) // every fixture MRN is distinct
  })

  it('completeness is the six rows in one drillable list', () => {
    expect(k.completeness.map((r) => [r.name, r.ids])).toEqual([
      ['No delay reason recorded', []],
      ['Open, no update for 12 h', ['C3', 'C4']],
      ['Open 24 h with no disposition decided', ['C4']],
      ['Resolved without a disposition', []],
      ['Times out of order', ['C12']], // its consult was "seen" before it was requested
      ['Registration in the future', []],
    ])
  })

  it('targets carry the cases that missed them, which is ids minus withinIds', () => {
    const byKey = Object.fromEntries(k.targets.map((t) => [t.key, t]))
    expect(k.targets.map((t) => t.key)).toEqual(['lab60', 'imaging90', 'consult60', 'decision150', 'toWard30'])
    expect(byKey.lab60).toMatchObject({ n: 1, within: 0, ids: ['C3'], missedIds: ['C3'], share: null })
    expect(byKey.imaging90).toMatchObject({ n: 1, within: 0, missedIds: ['C6'] })
    // C1 met its one consult, C2 missed its one, C5 met one of two: two of four units within.
    expect(byKey.consult60).toMatchObject({ n: 4, within: 2, ids: ['C1', 'C2', 'C5'], withinIds: ['C1'], share: 0.5 })
    expect(byKey.consult60!.missedIds).toEqual(['C2', 'C5'])
    expect(byKey.decision150).toMatchObject({ n: 0, share: null }) // no physician or decision times
    expect(byKey.toWard30).toMatchObject({ n: 1, within: 0, missedIds: ['C5'] })
  })

  it('the Adaa overall row counts the five resolved cases into the treated-within bands', () => {
    // Door to disposition: C12 2 h, C7 6 h, C8 7 h, C5 8 h, C6 10 h.
    expect(k.treated.map((r) => r.value)).toEqual([1, 1, 3, 0, 0, 0, 0])
    expect(k.adaaOverall.ctas).toBe('overall')
    expect(k.adaaOverall.total).toBe(10)
    expect(k.adaaOverall.treatedN).toBe(5)
    expect(k.adaaOverall.withinFourShare).toBe(0.2)
    expect(k.adaaOverall.damaShare).toBe(0.2) // C8 among five resolved
    expect(k.adaaOverall.nonUrgentShare).toBeCloseTo(1 / 3, 10) // C6 among the three with a CTAS
    // No physician or decision time anywhere in this fixture, so KPI 1-3 have nothing to measure.
    expect([k.adaaOverall.kpi1N, k.adaaOverall.kpi2N, k.adaaOverall.kpi3N]).toEqual([0, 0, 0])
    expect(k.adaa.map((r) => r.ctas)).toEqual([1, 2, 3, 4, 5, 'unknown', 'overall'])
  })

  it('turnaround bands, by CTAS and by area', () => {
    const lab = k.turnaround.find((r) => r.type === 'LAB')!
    expect(lab.orderToResult.map((r) => r.value)).toEqual([0, 0, 0, 0, 1, 0]) // C3: 4 h
    expect(lab.doneToReport.map((r) => r.value)).toEqual([0, 0, 0, 1, 0, 0]) // C3: received to resulted, 2 h
    const ct = k.turnaround.find((r) => r.type === 'CT')!
    expect(ct.orderToResult.map((r) => r.value)).toEqual([0, 0, 0, 0, 1, 0]) // C6: order to preliminary, 3 h
    expect(k.byCtas.map((r) => [r.name, r.n])).toEqual([
      ['1', 0],
      ['2', 1],
      ['3', 1],
      ['4', 1],
      ['5', 0],
      ['Not recorded', 7],
    ])
    expect(k.byArea.map((r) => [r.name, r.n])).toEqual([
      ['Acute area', 1],
      ['Rapid assessment zone', 1],
      ['Resuscitation area', 1],
      ['Not recorded', 7],
    ])
    // No ward code and no physician time in this fixture: both sections have nothing to show.
    expect(k.admissionToUnit.every((g) => g.bands.every((b) => b.value === 0))).toBe(true)
    expect(k.examToConsult).toEqual([])
  })
})
