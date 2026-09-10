import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type CaseFilter } from '@/src/lib/domain/case-filter'
import { narrowingLine } from '../board/HandoverSheet'

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
