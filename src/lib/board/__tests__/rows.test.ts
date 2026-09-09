import { describe, expect, it } from 'vitest'
import {
  bandOf,
  countsOf,
  elapsedOf,
  idleHours,
  isStale,
  lastActivityAt,
  normalizeMrnQuery,
  parseFilter,
  reasonText,
  resolvedText,
  searchRows,
  sortByElapsed,
  STALE_AFTER_H,
  stalenessText,
} from '../rows'
import type { BoardRow } from '../types'

const NOW = new Date('2026-09-09T12:00:00.000Z')
const hoursBefore = (h: number): string => new Date(NOW.getTime() - h * 36e5).toISOString()

function row(over: Partial<BoardRow> & Pick<BoardRow, 'id' | 'mrn'>): BoardRow {
  return {
    status: 'OPEN',
    registrationAt: hoursBefore(1),
    departedAt: null,
    resolvedAt: null,
    ctas: null,
    area: null,
    primaryReason: null,
    departments: [],
    disposition: null,
    ward: null,
    createdAt: hoursBefore(1),
    lastUpdateAt: null,
    reviewedAt: null,
    // The sort, search and staleness helpers read the clock and the MRN only; a row's Phase 8
    // timeline is the handover sheet's business.
    timeline: [],
    ...over,
  }
}

describe('parseFilter', () => {
  it('accepts the three the URL may carry and defaults everything else to open', () => {
    expect(parseFilter('open')).toBe('open')
    expect(parseFilter('resolved')).toBe('resolved')
    expect(parseFilter('all')).toBe('all')
    expect(parseFilter(null)).toBe('open')
    expect(parseFilter('')).toBe('open')
    expect(parseFilter('voided')).toBe('open')
    expect(parseFilter('VOIDED')).toBe('open')
  })
})

describe('elapsed time on a row', () => {
  it('runs to now while the case is open and stops at the departure time once resolved', () => {
    expect(elapsedOf(row({ id: 'a', mrn: '1', registrationAt: hoursBefore(6) }), NOW)).toBeCloseTo(6, 6)
    const resolved = row({
      id: 'b',
      mrn: '2',
      status: 'RESOLVED',
      registrationAt: hoursBefore(9),
      departedAt: hoursBefore(3),
      resolvedAt: hoursBefore(1),
    })
    expect(elapsedOf(resolved, NOW)).toBeCloseTo(6, 6)
  })

  it('falls back to resolvedAt when nobody recorded a departure time', () => {
    const resolved = row({
      id: 'c',
      mrn: '3',
      status: 'RESOLVED',
      registrationAt: hoursBefore(9),
      resolvedAt: hoursBefore(4),
    })
    expect(elapsedOf(resolved, NOW)).toBeCloseTo(5, 6)
  })

  it('is null — the neutral band — when the registration time is in the future', () => {
    const future = row({ id: 'd', mrn: '4', registrationAt: new Date(NOW.getTime() + 36e5).toISOString() })
    expect(elapsedOf(future, NOW)).toBeNull()
    expect(bandOf(future, NOW)).toBe('none')
  })

  it('colours each threshold the way the prototype does', () => {
    const at = (h: number): string => bandOf(row({ id: 'x', mrn: '5', registrationAt: hoursBefore(h) }), NOW)
    expect(at(0.5)).toBe('ok')
    expect(at(3.99)).toBe('ok')
    expect(at(4)).toBe('h4')
    expect(at(6)).toBe('h6')
    expect(at(12)).toBe('h12')
    expect(at(24)).toBe('h24')
    expect(at(48)).toBe('h24')
  })
})

describe('sort order', () => {
  it('is longest stay first, with rows that have no elapsed time last', () => {
    const rows = [
      row({ id: 'four', mrn: '104', registrationAt: hoursBefore(4) }),
      row({ id: 'null', mrn: '199', registrationAt: new Date(NOW.getTime() + 36e5).toISOString() }),
      row({ id: 'thirty', mrn: '130', registrationAt: hoursBefore(30) }),
      row({ id: 'twelve', mrn: '112', registrationAt: hoursBefore(12) }),
    ]
    expect(sortByElapsed(rows, NOW).map((r) => r.id)).toEqual(['thirty', 'twelve', 'four', 'null'])
  })

  it('keeps every row that has no elapsed time, in the order they arrived', () => {
    const future = new Date(NOW.getTime() + 36e5).toISOString()
    const rows = [
      row({ id: 'n1', mrn: '1', registrationAt: future }),
      row({ id: 'n2', mrn: '2', registrationAt: future }),
      row({ id: 'real', mrn: '3', registrationAt: hoursBefore(2) }),
    ]
    expect(sortByElapsed(rows, NOW).map((r) => r.id)).toEqual(['real', 'n1', 'n2'])
  })

  it('does not mutate the array it was given', () => {
    const rows = [
      row({ id: 'a', mrn: '1', registrationAt: hoursBefore(1) }),
      row({ id: 'b', mrn: '2', registrationAt: hoursBefore(9) }),
    ]
    sortByElapsed(rows, NOW)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('staleness', () => {
  it('takes the last activity from the newest of the case row and its updates', () => {
    const r = row({ id: 'a', mrn: '1', createdAt: hoursBefore(9), lastUpdateAt: hoursBefore(3) })
    expect(lastActivityAt(r).toISOString()).toBe(hoursBefore(3))
  })

  it('falls back to the case row when there has never been an update', () => {
    const r = row({ id: 'a', mrn: '1', createdAt: hoursBefore(5), lastUpdateAt: null })
    expect(lastActivityAt(r).toISOString()).toBe(hoursBefore(5))
  })

  it('ignores an update older than the case row rather than going backwards', () => {
    const r = row({ id: 'a', mrn: '1', createdAt: hoursBefore(2), lastUpdateAt: hoursBefore(8) })
    expect(lastActivityAt(r).toISOString()).toBe(hoursBefore(2))
  })

  it('turns amber at exactly two hours, not a minute before', () => {
    expect(STALE_AFTER_H).toBe(2)
    const justUnder = row({ id: 'a', mrn: '1', createdAt: hoursBefore(2 - 1 / 60) })
    const exactly = row({ id: 'b', mrn: '2', createdAt: hoursBefore(2) })
    const over = row({ id: 'c', mrn: '3', createdAt: hoursBefore(2 + 1 / 60) })

    expect(isStale(idleHours(justUnder, NOW))).toBe(false)
    expect(isStale(idleHours(exactly, NOW))).toBe(true)
    expect(isStale(idleHours(over, NOW))).toBe(true)

    expect(stalenessText(idleHours(justUnder, NOW))).toBe('Updated 1h 59m ago')
    expect(stalenessText(idleHours(exactly, NOW))).toBe('No update for 2h 00m')
    expect(stalenessText(idleHours(over, NOW))).toBe('No update for 2h 01m')
  })

  it('says nothing about staleness on a resolved case', () => {
    const r = row({ id: 'a', mrn: '1', status: 'RESOLVED', createdAt: hoursBefore(30), departedAt: hoursBefore(20) })
    expect(idleHours(r, NOW)).toBeNull()
    expect(isStale(null)).toBe(false)
    expect(stalenessText(null)).toBeNull()
  })
})

describe('MRN search', () => {
  it('strips every non-digit before matching, as the prototype does', () => {
    expect(normalizeMrnQuery('8515')).toBe('8515')
    expect(normalizeMrnQuery(' 85-15 ')).toBe('8515')
    expect(normalizeMrnQuery('mrn 8515')).toBe('8515')
    expect(normalizeMrnQuery('abc')).toBe('')
    expect(normalizeMrnQuery('')).toBe('')
  })

  it('matches anywhere in the MRN and keeps everything when nothing numeric was typed', () => {
    const rows = [
      row({ id: 'a', mrn: '851501' }),
      row({ id: 'b', mrn: '208515' }),
      row({ id: 'c', mrn: '400200' }),
    ]
    expect(searchRows(rows, '8515').map((r) => r.id)).toEqual(['a', 'b'])
    expect(searchRows(rows, '85-15').map((r) => r.id)).toEqual(['a', 'b'])
    expect(searchRows(rows, 'abc').map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(searchRows(rows, '').map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(searchRows(rows, '9999')).toEqual([])
  })
})

describe('the counts strip', () => {
  const fixture = [
    hoursBefore(0.5),
    hoursBefore(5.9),
    hoursBefore(6),
    hoursBefore(11.9),
    hoursBefore(12),
    hoursBefore(30),
  ]

  it('counts every open case, and the 6 h and 12 h subsets at the threshold itself', () => {
    expect(countsOf(fixture, NOW)).toEqual({ open: 6, past6: 4, past12: 2 })
  })

  it('is all zeroes when nothing is open', () => {
    expect(countsOf([], NOW)).toEqual({ open: 0, past6: 0, past12: 0 })
  })

  it('still counts a case whose registration time is in the future as open', () => {
    const future = new Date(NOW.getTime() + 36e5).toISOString()
    expect(countsOf([future, hoursBefore(7)], NOW)).toEqual({ open: 2, past6: 1, past12: 0 })
  })
})

describe('the two text lines', () => {
  it('joins the primary reason with the consulted departments', () => {
    expect(reasonText(row({ id: 'a', mrn: '1', primaryReason: 'No bed available on accepting ward' }))).toBe(
      'No bed available on accepting ward',
    )
    expect(
      reasonText(
        row({
          id: 'a',
          mrn: '1',
          primaryReason: 'Referral sent, awaiting acceptance',
          departments: ['Internal Medicine', 'ICU'],
        }),
      ),
    ).toBe('Referral sent, awaiting acceptance · Internal Medicine, ICU')
  })

  it('says so when no reason was chosen', () => {
    expect(reasonText(row({ id: 'a', mrn: '1' }))).toBe('No reason set')
    expect(reasonText(row({ id: 'a', mrn: '1', departments: ['ICU'] }))).toBe('No reason set · ICU')
  })

  it('renders the outcome of a resolved case as disposition and ward', () => {
    expect(resolvedText(row({ id: 'a', mrn: '1', status: 'RESOLVED', disposition: 'ADMITTED', ward: 'ICU' }))).toBe(
      'Admitted · ICU',
    )
    expect(resolvedText(row({ id: 'a', mrn: '1', status: 'RESOLVED', disposition: 'DISCHARGED_HOME' }))).toBe(
      'Discharged home',
    )
    expect(resolvedText(row({ id: 'a', mrn: '1', status: 'RESOLVED' }))).toBe('')
  })
})
