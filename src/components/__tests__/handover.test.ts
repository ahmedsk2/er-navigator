import { describe, expect, it } from 'vitest'
import type { BoardRow } from '@/src/lib/board/types'
import { EMPTY_FILTER, type CaseFilter } from '@/src/lib/domain/case-filter'
import { actionLine, lastUpdateText, narrowingLine, SHEET_ACTION_MAX } from '../board/HandoverSheet'

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
    delayActionTaken: null,
    escalatedToMedicalDirector: null,
    trajectory: null,
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

/**
 * Phase 14 (docs/specs/phase14-actions-and-escalation.md, item 7): the line the sheet prints under
 * a case that carries what was done about its delay, or an answer about the medical director.
 */
describe('actionLine', () => {
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
    delayActionTaken: null,
    escalatedToMedicalDirector: null,
    trajectory: null,
    timeline: [],
    ...over,
  })

  it('prints nothing for a case nobody has answered, so an old sheet is unchanged', () => {
    expect(actionLine(row({}))).toBeNull()
    expect(actionLine(row({ delayActionTaken: '   ' }))).toBeNull()
  })

  it('prints the action, the escalation, or both on the one line', () => {
    expect(actionLine(row({ delayActionTaken: 'Bed manager called twice' }))).toBe(
      'Action: Bed manager called twice',
    )
    expect(actionLine(row({ escalatedToMedicalDirector: true }))).toBe('Escalated to medical director: Yes')
    expect(actionLine(row({ escalatedToMedicalDirector: false }))).toBe('Escalated to medical director: No')
    expect(
      actionLine(row({ delayActionTaken: '  ICU holding a bed  ', escalatedToMedicalDirector: true })),
    ).toBe('Action: ICU holding a bed · Escalated to medical director: Yes')
  })

  /**
   * Phase 15 (docs/specs/phase15-trajectory.md, item 6): the trajectory opens the line, because
   * the question a charge nurse asks at a handover is "where is this one going?" before "and what
   * did we do about it?". A part of this line and not an eighth column: the seven headers are
   * pinned and a ward printer's page is already full.
   */
  it('opens with the trajectory when the case carries one', () => {
    expect(actionLine(row({ trajectory: 'ADMISSION' }))).toBe('Trajectory: Admission')
    expect(actionLine(row({ trajectory: 'TRANSFER' }))).toBe('Trajectory: Transfer to another facility')
    expect(
      actionLine(
        row({ trajectory: 'DISCHARGE', delayActionTaken: 'Pharmacy chased', escalatedToMedicalDirector: false }),
      ),
    ).toBe('Trajectory: Discharge · Action: Pharmacy chased · Escalated to medical director: No')
  })

  /**
   * Phase 15, item 9 — the second of the two questions the Phase 14 close left with Ahmed. The
   * box holds up to a thousand characters and the sheet is an 11 px table read standing up at a
   * shift change, so the sheet cuts the action at 200 characters. The case keeps the whole text.
   */
  describe('the action is cut at 200 characters on the sheet (Phase 15, item 9)', () => {
    it('prints a short action whole, and a long one cut with an ellipsis', () => {
      const short = 'x'.repeat(SHEET_ACTION_MAX)
      expect(actionLine(row({ delayActionTaken: short }))).toBe(`Action: ${short}`)

      const long = 'y'.repeat(SHEET_ACTION_MAX + 1)
      const line = actionLine(row({ delayActionTaken: long }))!
      expect(line).toBe(`Action: ${'y'.repeat(SHEET_ACTION_MAX)}…`)
      expect(line).not.toContain('y'.repeat(SHEET_ACTION_MAX + 1))
    })

    it('cuts nothing else on the line: the trajectory and the escalation are printed whole', () => {
      const line = actionLine(
        row({
          trajectory: 'ADMISSION',
          delayActionTaken: 'z'.repeat(400),
          escalatedToMedicalDirector: true,
        }),
      )!
      expect(line.startsWith('Trajectory: Admission · Action: ')).toBe(true)
      expect(line.endsWith('… · Escalated to medical director: Yes')).toBe(true)
    })

    it('does not print a space before the ellipsis when the cut lands on one', () => {
      const wordy = `${'a'.repeat(SHEET_ACTION_MAX - 1)} then the ward called back`
      expect(actionLine(row({ delayActionTaken: wordy }))).toBe(`Action: ${'a'.repeat(SHEET_ACTION_MAX - 1)}…`)
    })
  })
})
