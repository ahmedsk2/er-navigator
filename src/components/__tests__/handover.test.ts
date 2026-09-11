import { describe, expect, it } from 'vitest'
import type { BoardRow } from '@/src/lib/board/types'
import { EMPTY_FILTER, type CaseFilter } from '@/src/lib/domain/case-filter'
import { lastUpdateText, narrowingLine } from '../board/HandoverSheet'

/**
 * The line a handover sheet prints under its stamp when the board it was printed from was
 * narrowed (Phase 10 review). The sheet itself has no unit test — there is no DOM harness — and is
 * read under print emulation in tests/e2e/board.spec.ts; this pins the sentence.
 */
const REFERENCE = {
  stages: [
    { code: 'inv', name: 'Investigations' },
    { code: 'adm', name: 'Admission process' },
  ],
  areas: [{ code: 'RAZ', name: 'Rapid assessment zone' }],
}

const filter = (over: Partial<CaseFilter>): CaseFilter => ({ ...EMPTY_FILTER, ...over })

describe('narrowingLine', () => {
  it('says nothing for the whole board, so its sheet prints as it always has', () => {
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, '')).toBeNull()
    // The two modes alone select nothing, so they narrow nothing either.
    expect(narrowingLine(filter({ not: true, lone: true }), REFERENCE, '')).toBeNull()
  })

  it("names the case filter in describeFilter's own sentence", () => {
    expect(narrowingLine(filter({ stage: ['adm'] }), REFERENCE, '')).toBe(
      'Filtered: Stage: Admission process',
    )
    expect(narrowingLine(filter({ stage: ['adm', 'inv'], not: true }), REFERENCE, '')).toBe(
      'Filtered: Excluding Stage: Admission process or Investigations',
    )
    expect(narrowingLine(filter({ area: ['RAZ'], ctas: [3] }), REFERENCE, '')).toBe(
      'Filtered: Area: Rapid assessment zone · CTAS 3',
    )
  })

  it('names the MRN search by the digits it matched on, and only when it narrows anything', () => {
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, '310000')).toBe('MRN search: 310000')
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, ' 31000-02 ')).toBe('MRN search: 3100002')
    // No digit, no narrowing: `searchRows` hands every row back, and the sheet says nothing.
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, 'Haddad')).toBeNull()
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, '   ')).toBeNull()
  })

  it('never puts the letters typed into the search box on paper', () => {
    expect(narrowingLine(EMPTY_FILTER, REFERENCE, 'Haddad 851557')).toBe('MRN search: 851557')
  })

  it('puts both on the one line, the filter first', () => {
    expect(narrowingLine(filter({ stage: ['adm'] }), REFERENCE, '310000')).toBe(
      'Filtered: Stage: Admission process · MRN search: 310000',
    )
  })
})

/**
 * Phase 11, finding 8: the Last update column is a clock time. "Updated 0h 12m ago" was true when
 * the sheet was printed and wrong by the time it was read at the handover.
 */
describe('lastUpdateText', () => {
  const row = (over: Partial<BoardRow>): BoardRow => ({
    id: 'c1',
    mrn: '100001',
    status: 'OPEN',
    registrationAt: '2026-09-09T02:00:00.000Z',
    departedAt: null,
    resolvedAt: null,
    ctas: null,
    area: null,
    payer: null,
    diagnosis: null,
    primaryReason: null,
    stageCodes: [],
    reasonNames: [],
    departments: [],
    disposition: null,
    ward: null,
    createdAt: '2026-09-09T03:00:00.000Z',
    lastUpdateAt: null,
    reviewedAt: null,
    timeline: [],
    ...over,
  })

  it("prints an open case's newest update as dd/mm HH:mm in Asia/Riyadh", () => {
    // 09:30 UTC is 12:30 in Riyadh.
    expect(lastUpdateText(row({ lastUpdateAt: '2026-09-09T09:30:00.000Z' }))).toBe('09/09 12:30')
  })

  it('prints when the case was opened when nobody has written an update, as the board counts it', () => {
    expect(lastUpdateText(row({}))).toBe('09/09 06:00')
  })

  it('crosses midnight in Riyadh, not in UTC', () => {
    expect(lastUpdateText(row({ lastUpdateAt: '2026-09-09T21:05:00.000Z' }))).toBe('10/09 00:05')
  })

  it("prints a resolved case's last update, or a dash when it has none", () => {
    const resolved = { status: 'RESOLVED' as const, departedAt: '2026-09-09T10:00:00.000Z' }
    expect(lastUpdateText(row({ ...resolved, lastUpdateAt: '2026-09-09T10:00:00.000Z' }))).toBe('09/09 13:00')
    expect(lastUpdateText(row(resolved))).toBe('–')
  })

  it('never prints a relative time', () => {
    expect(lastUpdateText(row({ lastUpdateAt: new Date().toISOString() }))).toMatch(/^\d\d\/\d\d \d\d:\d\d$/)
  })
})
