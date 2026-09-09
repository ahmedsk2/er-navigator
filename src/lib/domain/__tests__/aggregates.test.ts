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

describe('all-time dashboard adds C9', () => {
  it('median LOS over six resolved (2,6,7,8,9,10) = 7.5; Resus and TRANSFERRED appear', () => {
    const d = dashboard(FIXTURE, 'all', NOW)
    expect(d.total).toBe(11)
    expect(d.inRange).toBe(11)
    expect(d.tiles.medianLos).toBe(7.5)
    expect(row(d.byStage, 'Resus room')?.value).toBe(1)
    expect(row(d.byDispo, 'TRANSFERRED')?.value).toBe(1)
  })
})
