import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_BLOCKS,
  admissionStats,
  arrivalGrid,
  byDay,
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
import type { KpiCase } from '../kpi'
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
 * Phase 8: `src/lib/domain/kpi.ts` takes a `KpiCase`, a structural subset of `CaseForStats`.
 * Assigning the fixture to that type is the contract check: a field dropped from
 * `CaseForStats`, or handed back with the wrong type, is a compile error in this file.
 */
describe('CaseForStats satisfies the KpiCase contract', () => {
  it('every case in the fixture is usable as a KpiCase', () => {
    const asKpi: KpiCase[] = FIXTURE
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
    expect(k.headline.atLeast10Share).toBe(0.3)
    expect(k.headline.atLeast12Share).toBe(0.2)
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
      ['Leadership escalation', 0],
      ['Case / bed management', 1],
      ['External transfer / fax / RCC', 0],
      ['PRO / social work', 0],
      ['Forced / safety admission', 0],
      ['DAMA management', 0],
      ['Update without an action tag', 0],
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

  it('completeness is the nine rows in one drillable list', () => {
    expect(k.completeness.map((r) => [r.name, r.ids])).toEqual([
      ['No delay reason recorded', []],
      ['Open, no update for 12 h', ['C3', 'C4']],
      ['Open 24 h with no disposition decided', ['C4']],
      ['Resolved without a disposition', []],
      ['Times out of order', ['C12']], // its consult was "seen" before it was requested
      ['Stay cannot be computed (leaving before registration)', []],
      ['Resolved, not yet reviewed', ['C5', 'C6', 'C7', 'C8', 'C12']],
      ['Painkiller prescribed, no time given recorded', []],
      ['Pethidine prescribed, dose missing or not 50 / 100 / 150 mg', []],
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

  /**
   * Phase 8b: the three lists this layer added, so the pain block and the discharge answers can be
   * drilled into. Nothing in the base fixture records one, so the cases are overridden here; the
   * arithmetic itself is `kpi.ts`'s and is tested there.
   */
  it('the pain block and the discharge answers arrive with their case ids', () => {
    const cases = FIXTURE.map((c) =>
      c.id === 'C1'
        ? {
            ...c,
            // Registered 3 h ago, painkiller 20 minutes later: the first band.
            painkillerPrescribed: 'YES' as const,
            painkillerAt: new Date(c.registrationAt.getTime() + 20 * 60_000),
            pethidinePrescribed: 'YES' as const,
            pethidineDoseMg: 100,
            instructionsGiven: 'YES' as const,
            familyEngagement: 'NO' as const,
          }
        : c.id === 'C5'
          ? { ...c, instructionsGiven: 'NOT_SURE' as const }
          : c,
    )
    const panels = dashboard(cases, '30', NOW).kpi
    expect(panels.painkiller.map((r) => [r.name, r.ids])).toEqual([
      ['≤30 min', ['C1']],
      ['>30 min–1 h', []],
      ['>1–3 h', []],
      ['>3 h', []],
    ])
    expect(panels.pethidine.map((r) => [r.name, r.ids])).toEqual([
      ['50 mg', []],
      ['100 mg', ['C1']],
      ['150 mg', []],
    ])
    // The counts on the Adaa row and the ids on the drillable list are the same figures.
    expect(panels.adaaOverall.painkiller).toEqual(panels.painkiller.map((r) => r.value))
    expect(panels.adaaOverall.pethidine).toEqual(panels.pethidine.map((r) => r.value))
    expect(panels.adaaOverall.painkillerYesN).toBe(1)
    expect(panels.adaaOverall.pethidineYesN).toBe(1)
    // Two cases answered "instructions given", one of them Yes; one answered "family engaged", No.
    expect(panels.communication.map((r) => [r.name, r.n, r.within, r.ids, r.share])).toEqual([
      ['Instructions given by doctor', 2, 1, ['C1', 'C5'], null],
      ['Family engaged', 1, 0, ['C1'], null],
    ])
  })
})

describe('Phase 10 panels', () => {
  const k = dashboard(FIXTURE, '30', NOW).kpi
  it('carries the phase split and the payer rows, in their fixed orders', () => {
    expect(k.phases.phases.map((p) => p.key)).toEqual(['front', 'decision', 'after'])
    // The fixture records no physician or decision time, so nothing is measured here; the maths is
    // hand-checked in kpi.test.ts, this is the wiring.
    expect(k.phases.completeN).toBe(0)
    expect(k.phases.phases.every((p) => p.n === 0 && p.share === null)).toBe(true)
    expect(k.byPayer.map((r) => r.name)).toEqual(['Government', 'Insured', 'Self-pay', 'Not recorded'])
  })
})

/**
 * Phase 11: the stay split arrives on `kpi` over the same case list as every other panel — the
 * range's, already narrowed by any filter. The maths is `kpi.ts`'s and is hand-checked there; the
 * fixture records no physician or decision time, so four resolved cases are given both here:
 * C5 (admitted) 1, 2 and 5 h; C6 (home) 1, 4 and 5; C7 (home) 0.5, 3.5 and 2; and C9 (transferred,
 * forty days ago) 1, 4 and 4.
 */
describe('Phase 11 panels', () => {
  const timed = FIXTURE.map((c) => {
    const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 36e5)
    if (c.id === 'C5') return { ...c, physicianAt: at(29), decisionAt: at(27) }
    if (c.id === 'C6') return { ...c, physicianAt: at(49), decisionAt: at(45) }
    if (c.id === 'C7') return { ...c, physicianAt: at(73.5), decisionAt: at(70) }
    if (c.id === 'C9') return { ...c, physicianAt: at(959), decisionAt: at(955) }
    return c
  })

  it('splits the stay over the range, then by outcome', () => {
    const split = dashboard(timed, '30', NOW).kpi.staySplit
    expect(split.map((r) => r.key)).toEqual(['all', 'admitted', 'discharged', 'transferred', 'other'])
    expect(split[0]!.split.completeIds).toEqual(['C5', 'C6', 'C7'])
    // front 1 + 1 + 0.5, decision 2 + 4 + 3.5, after 5 + 5 + 2: 2.5, 9.5 and 12 of 24 hours.
    expect(split[0]!.split.phases.map((p) => p.share)).toEqual([2.5 / 24, 9.5 / 24, 12 / 24])
    expect(split.find((r) => r.key === 'discharged')!.split.completeIds).toEqual(['C6', 'C7'])
    // C9 registered forty days ago: in no bar of the thirty-day page, and in the all-time one.
    expect(split.find((r) => r.key === 'transferred')!.split.completeIds).toEqual([])
    const all = dashboard(timed, 'all', NOW).kpi.staySplit
    expect(all[0]!.split.completeIds).toEqual(['C5', 'C6', 'C7', 'C9'])
    expect(all.find((r) => r.key === 'transferred')!.split.completeIds).toEqual(['C9'])
  })

  it('draws over the filtered population, because the filter narrows the cases first', () => {
    // The page applies the filter before `dashboard()` runs; handing it fewer cases is the filter.
    const onlyHome = timed.filter((c) => c.disposition === 'DISCHARGED_HOME')
    const split = dashboard(onlyHome, '30', NOW).kpi.staySplit
    expect(split[0]!.split.completeIds).toEqual(['C6', 'C7'])
    expect(split.find((r) => r.key === 'admitted')!.split.completeIds).toEqual([])
  })
})

/** A fixture case moved to another registration instant (and, for a stay, another leaving one). */
const at = (id: string, registrationAt: string, over: Partial<(typeof FIXTURE)[number]> = {}) => ({
  ...FIXTURE[0]!,
  id,
  mrn: `2${id}`,
  registrationAt: new Date(registrationAt),
  ...over,
})

/**
 * Phase 11: the last days, one bar per Asia/Riyadh calendar day. Registration in Riyadh, from the
 * fixture's own comments: C8 Sat 29 Aug 15:00, C7 Sat 5 Sep 13:00, C6 Sun 6 Sep 13:00, C5 Mon 7 Sep
 * 09:00, C4 Mon 14:00, C12 Mon 19:00, C3 Tue 8 Sep 02:00, C2 Tue 08:00, C11 Tue 11:00, C1 Tue
 * 12:00; NOW is Tue 8 Sep 15:00.
 */
describe('Phase 11: by day', () => {
  it('thirty days is one row per Riyadh day from the window start to today, the empty ones kept', () => {
    const days = byDay(inRange(FIXTURE, '30', NOW), '30', NOW)
    // The window opens at 15:00 on Sun 9 Aug, thirty days before NOW, so that partial day is the
    // first bar and today is the thirty-first.
    expect(days).toHaveLength(31)
    expect(days[0]).toEqual({ date: '2026-08-09', name: '09/08', weekday: 'Sun', cases: 0, ids: [], med: null })
    expect(days.at(-1)).toMatchObject({ date: '2026-09-08', name: '08/09', weekday: 'Tue' })
    expect(days.filter((d) => d.cases > 0).map((d) => [d.date, d.ids])).toEqual([
      ['2026-08-29', ['C8']],
      ['2026-09-05', ['C7']],
      ['2026-09-06', ['C6']],
      ['2026-09-07', ['C4', 'C5', 'C12']],
      ['2026-09-08', ['C1', 'C2', 'C3', 'C11']],
    ])
    expect(days.reduce((n, d) => n + d.cases, 0)).toBe(10)
    // Consecutive calendar days, nothing skipped and nothing twice.
    const step = days.slice(1).map((d, i) => (Date.parse(d.date) - Date.parse(days[i]!.date)) / 864e5)
    expect(new Set(step)).toEqual(new Set([1]))
  })

  it('gives a median only to a day with three stays: Mon 25, 8, 2 -> 8; Tue 3, 7, 13, 4 -> 5.5', () => {
    const days = byDay(inRange(FIXTURE, '30', NOW), '30', NOW)
    const day = (date: string) => days.find((d) => d.date === date)!
    expect(day('2026-09-07').med).toBe(8)
    expect(day('2026-09-08').med).toBe(5.5)
    for (const date of ['2026-08-29', '2026-09-05', '2026-09-06']) expect(day(date).med, date).toBeNull()
  })

  it('seven days is eight bars, because the window starts part way through a day', () => {
    const days = byDay(inRange(FIXTURE, '7', NOW), '7', NOW)
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
    ])
    expect(days.map((d) => d.cases)).toEqual([0, 0, 0, 0, 1, 1, 3, 4])
  })

  it('all time runs from the first case to today', () => {
    const days = byDay(inRange(FIXTURE, 'all', NOW), 'all', NOW)
    // C9 registered at 15:00 on Thu 30 Jul, forty days before NOW.
    expect(days[0]).toMatchObject({ date: '2026-07-30', weekday: 'Thu', ids: ['C9'] })
    expect(days).toHaveLength(41)
    expect(days.reduce((n, d) => n + d.cases, 0)).toBe(11)
    expect(byDay([], 'all', NOW).map((d) => d.date)).toEqual(['2026-09-08'])
  })

  it('cuts the day at Riyadh midnight, which is 21:00 UTC', () => {
    const days = byDay([at('late', '2026-09-07T20:59:59Z'), at('early', '2026-09-07T21:00:00Z')], '7', NOW)
    expect(days.find((d) => d.date === '2026-09-07')!.ids).toEqual(['late'])
    expect(days.find((d) => d.date === '2026-09-08')!.ids).toEqual(['early'])
  })

  it('never loses a case: a registration dated after today gets its own bar', () => {
    // 01:00 on Wed 9 Sep in Riyadh, ten hours after NOW: a clock that ran ahead.
    const days = byDay([at('ahead', '2026-09-08T22:00:00Z')], '7', NOW)
    expect(days.at(-1)).toMatchObject({ date: '2026-09-09', ids: ['ahead'] })
    expect(days.reduce((n, d) => n + d.cases, 0)).toBe(1)
  })

  it('leaves a voided case out, and counts a stay it cannot compute as no median', () => {
    expect(byDay(FIXTURE.filter((c) => c.id === 'C10'), '7', NOW).every((d) => d.cases === 0)).toBe(true)
    // Three cases on Mon 7 Sep, one of them leaving before it registered: three cases, two stays.
    const day = byDay(
      [
        at('m1', '2026-09-07T06:00:00Z', { status: 'RESOLVED', departedAt: new Date('2026-09-07T10:00:00Z'), resolvedAt: new Date('2026-09-07T10:00:00Z') }),
        at('m2', '2026-09-07T07:00:00Z', { status: 'RESOLVED', departedAt: new Date('2026-09-07T12:00:00Z'), resolvedAt: new Date('2026-09-07T12:00:00Z') }),
        at('m3', '2026-09-07T08:00:00Z', { status: 'RESOLVED', departedAt: new Date('2026-09-07T05:00:00Z'), resolvedAt: new Date('2026-09-07T05:00:00Z') }),
      ],
      '7',
      NOW,
    ).find((d) => d.date === '2026-09-07')!
    expect(day.cases).toBe(3)
    expect(day.med).toBeNull()
  })
})

/** Phase 11: when the delayed patients arrive, by Riyadh weekday and three-hour block. */
describe('Phase 11: arrivals by day and time', () => {
  it('is seven weekdays of eight blocks, Sunday first, every cell kept', () => {
    const grid = arrivalGrid(inRange(FIXTURE, '30', NOW))
    expect(ARRIVAL_BLOCKS).toEqual(['00–03', '03–06', '06–09', '09–12', '12–15', '15–18', '18–21', '21–24'])
    expect(grid.rows.map((r) => r.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(grid.rows.every((r) => r.cells.map((c) => c.block).join() === ARRIVAL_BLOCKS.join())).toBe(true)
  })

  it('files each case under its Riyadh weekday and block', () => {
    const grid = arrivalGrid(inRange(FIXTURE, '30', NOW))
    const filled = grid.rows.flatMap((r) => r.cells.filter((c) => c.value > 0).map((c) => [r.weekday, c.block, c.ids]))
    expect(filled).toEqual([
      ['Sun', '12–15', ['C6']],
      ['Mon', '09–12', ['C5']],
      ['Mon', '12–15', ['C4']],
      ['Mon', '18–21', ['C12']],
      ['Tue', '00–03', ['C3']],
      ['Tue', '06–09', ['C2']],
      ['Tue', '09–12', ['C11']],
      ['Tue', '12–15', ['C1']],
      ['Sat', '12–15', ['C7']],
      ['Sat', '15–18', ['C8']],
    ])
    expect(grid.max).toBe(1)
    expect(grid.rows.flatMap((r) => r.cells).reduce((n, c) => n + c.value, 0)).toBe(10)
  })

  it('starts a block on its hour, in Riyadh time, and counts two arrivals in one cell as two', () => {
    const grid = arrivalGrid([
      at('b1', '2026-09-06T23:59:59Z'), // Mon 7 Sep 02:59:59
      at('b2', '2026-09-07T00:00:00Z'), // Mon 03:00:00
      at('b3', '2026-09-07T20:30:00Z'), // Mon 23:30
      at('b4', '2026-09-07T20:59:00Z'), // Mon 23:59
      FIXTURE.find((c) => c.id === 'C10')!, // voided: nowhere
    ])
    const mon = grid.rows.find((r) => r.weekday === 'Mon')!
    const cell = (block: string) => mon.cells.find((c) => c.block === block)!
    expect(cell('00–03').ids).toEqual(['b1'])
    expect(cell('03–06').ids).toEqual(['b2'])
    expect(cell('21–24')).toEqual({ block: '21–24', value: 2, ids: ['b3', 'b4'] })
    expect(grid.max).toBe(2)
    expect(grid.rows.flatMap((r) => r.cells).reduce((n, c) => n + c.value, 0)).toBe(4)
    expect(arrivalGrid([]).max).toBe(0)
  })
})

describe('Phase 11: the dashboard carries both, over its own cases', () => {
  it('hands the range and the filtered cases to byDay and arrivalGrid', () => {
    const seven = dashboard(FIXTURE, '7', NOW)
    expect(seven.days).toEqual(byDay(inRange(FIXTURE, '7', NOW), '7', NOW))
    expect(seven.arrivals).toEqual(arrivalGrid(inRange(FIXTURE, '7', NOW)))
    // C8 is ten days old: on the thirty-day grid, not the seven-day one.
    const sat = (d: ReturnType<typeof dashboard>) => d.arrivals.rows.find((r) => r.weekday === 'Sat')!
    expect(sat(seven).cells.find((c) => c.block === '15–18')!.ids).toEqual([])
    expect(sat(dashboard(FIXTURE, '30', NOW)).cells.find((c) => c.block === '15–18')!.ids).toEqual(['C8'])
  })
})
