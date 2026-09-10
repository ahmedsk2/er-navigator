import { describe, expect, it } from 'vitest'
import { elapsedHours, endAt } from '@/src/lib/domain/time'
import { blankDraft } from '../load'
import type { LoadedCase } from '../load'
import { fmtStamp } from '../local-time'
import { caseClockOf, summaryOf, summaryText } from '../summary'
import type { CaseDraft, ReferenceData } from '../types'

/**
 * The case summary, in the `timeline.test.ts` style: one fixture with everything that has ever
 * been awkward on a real case — a retired reason, a primary, two consults, tagged and untagged
 * updates, one of the app's own system notes, and a supervisor's review — checked as JSON and
 * then as the text the Copy button puts on the clipboard.
 *
 * The load-bearing assertion is the last one: no update text and no resolution note reach either
 * shape. The summary is built to be shared, and free text is where a patient's name gets typed.
 */
const NOW = new Date('2026-09-10T12:00:00.000Z')
const T = (hoursBeforeNow: number): string => new Date(NOW.getTime() - hoursBeforeNow * 3_600_000).toISOString()

const REFERENCE: ReferenceData = {
  stages: [
    {
      id: 'st-inv',
      code: 'inv',
      name: 'Investigations',
      reasons: [
        { id: 'r-lab', name: 'Lab result delay', requiresDepartment: false, requiresReferralNo: false, isOther: false },
        { id: 'r-inv-other', name: 'Other', requiresDepartment: false, requiresReferralNo: false, isOther: true },
      ],
    },
    {
      id: 'st-adm',
      code: 'adm',
      name: 'Admission process',
      reasons: [
        {
          id: 'r-bed',
          name: 'No bed available on accepting ward',
          requiresDepartment: false,
          requiresReferralNo: false,
          isOther: false,
        },
        // An Admin deactivated this one after the case was opened; `loadReferenceForCase` still
        // hands it over, flagged, so the summary can name it instead of printing an id.
        {
          id: 'r-retired',
          name: 'Ward refuses handover',
          requiresDepartment: false,
          requiresReferralNo: false,
          isOther: false,
          retired: true,
        },
      ],
    },
  ],
  departments: [
    { id: 'd-im', name: 'Internal Medicine' },
    { id: 'd-surg', name: 'General Surgery' },
  ],
  wards: [{ id: 'w-icu', code: 'ICU', name: 'Intensive care' }],
  areas: [{ id: 'a-raz', code: 'RAZ', name: 'Rapid assessment zone' }],
}

function draft(over: Partial<CaseDraft> = {}): CaseDraft {
  return {
    ...blankDraft({ now: NOW, shift: 'MORNING' }),
    mrn: '3100002',
    registrationAt: T(9),
    ctas: 3,
    areaId: 'a-raz',
    diagnosis: 'Chest pain, for admission',
    payer: 'INSURED',
    stages: ['st-inv', 'st-adm'],
    reasons: [
      { reasonId: 'r-lab', otherText: null },
      { reasonId: 'r-retired', otherText: null },
      { reasonId: 'r-inv-other', otherText: 'Analyser down since the night shift' },
    ],
    // The primary sits third in the list above on purpose: the summary lifts it to the front.
    primaryReasonId: 'r-retired',
    consults: [
      { departmentId: 'd-im', consultedAt: T(7), seenAt: T(6), repliedAt: null },
      { departmentId: 'd-surg', consultedAt: T(5), seenAt: null, repliedAt: null },
    ],
    bedRequestedAt: T(4),
    medAdminInformedAt: T(3),
    ...over,
  }
}

function loaded(over: Partial<LoadedCase> = {}, draftOver: Partial<CaseDraft> = {}): LoadedCase {
  const d = draft(draftOver)
  return {
    id: 'case-1',
    status: 'OPEN',
    voidReason: null,
    openedByName: 'Nadia Navigator',
    openedAt: T(9),
    resolvedAt: null,
    draft: d,
    updates: [
      { id: 'u1', createdAt: T(6), text: 'Rang the ward, Mrs Smith is next', author: 'Nadia', action: 'BED_MANAGEMENT' },
      { id: 'u2', createdAt: T(5), text: 'Escalated to medical admin', author: 'Nadia', action: 'LEADERSHIP_ESCALATION' },
      { id: 'u3', createdAt: T(2), text: 'Still waiting', author: 'Nadia', action: null },
    ],
    review: null,
    timeline: [
      { key: 'registrationAt', label: 'Registration', at: T(9), fromPrevious: null },
      { key: 'triageAt', label: 'Triage', at: T(8.5), fromPrevious: 0.5 },
    ],
    ...over,
  }
}

/**
 * The clock of a loaded case: the one the summary and the editor's header both read, as the board
 * row reads `clockOf` in rows.ts. The editor used to build its own with `resolvedAt: null`, so a
 * resolved case whose "Left ED at" was cleared and saved counted on to every page load there while
 * the board row and the summary stood still at the resolution.
 */
describe('caseClockOf', () => {
  it('ends a resolved case whose departure time was cleared at its resolution', () => {
    const clock = caseClockOf(loaded({ status: 'RESOLVED', resolvedAt: T(3) }, { departedAt: null }))
    expect(clock).toEqual({
      status: 'RESOLVED',
      registrationAt: new Date(T(9)),
      departedAt: null,
      resolvedAt: new Date(T(3)),
    })
    expect(endAt(clock)).toEqual(new Date(T(3)))
    expect(elapsedHours(clock, NOW)).toBe(6)
    // And a day later it has not moved.
    expect(elapsedHours(clock, new Date(NOW.getTime() + 24 * 3_600_000))).toBe(6)
  })

  it('ends a resolved case at its departure time, even when the resolution is later', () => {
    const clock = caseClockOf(loaded({ status: 'RESOLVED', resolvedAt: T(1) }, { departedAt: T(2) }))
    expect(endAt(clock)).toEqual(new Date(T(2)))
    expect(elapsedHours(clock, NOW)).toBe(7)
  })

  it('gives a reopened case no end, although it keeps its old departure time', () => {
    const clock = caseClockOf(loaded({ status: 'OPEN', resolvedAt: null }, { departedAt: T(2) }))
    expect(endAt(clock)).toBeNull()
    expect(elapsedHours(clock, NOW)).toBe(9)
  })

  it("reads the editor's state as well as a loaded case", () => {
    // The editor holds the status, the resolution and the draft apart, and a departure time
    // typed while the page is open is in the draft before anything is saved.
    const clock = caseClockOf({ status: 'RESOLVED', resolvedAt: T(3), draft: { registrationAt: T(9), departedAt: T(5) } })
    expect(endAt(clock)).toEqual(new Date(T(5)))
  })
})

describe('summaryOf', () => {
  it('names the case: MRN, CTAS, area, payer and the working diagnosis', () => {
    const s = summaryOf(loaded(), REFERENCE, NOW)
    expect(s.mrn).toBe('3100002')
    expect(s.ctas).toBe(3)
    expect(s.areaName).toBe('Rapid assessment zone')
    expect(s.payerLabel).toBe('Insured')
    expect(s.diagnosis).toBe('Chest pain, for admission')
    expect(s.id).toBe('case-1')
    expect(s.generatedAt).toBe(NOW.toISOString())
  })

  it('clocks an open case to now and says it has not left', () => {
    const s = summaryOf(loaded(), REFERENCE, NOW)
    expect(s.status).toBe('OPEN')
    expect(s.leftAt).toBeNull()
    expect(s.elapsedHours).toBe(9)
    expect(s.band).toBe('h6')
  })

  it('clocks a resolved case to its departure time, whatever "now" is', () => {
    // `resolvedAt` an hour after the departure on purpose: "Left ED at" edited after the resolve
    // moves only the departure, and the departure is the end of the stay (`endAt`).
    const s = summaryOf(loaded({ status: 'RESOLVED', resolvedAt: T(1) }, { departedAt: T(2) }), REFERENCE, NOW)
    expect(s.leftAt).toBe(T(2))
    expect(s.elapsedHours).toBe(7)
    expect(s.band).toBe('h6')
  })

  it('clocks a resolved case whose departure time was cleared to its resolution, and freezes it there', () => {
    // A navigator can clear "Left ED at" on a resolved case and save: the draft's departure is
    // nullable and `saveCase` refuses only a voided case. The row is then RESOLVED with no
    // departure and its resolvedAt intact — kpi.ts's "Resolved (no departure time recorded)" —
    // and the board row stops its clock at resolvedAt. So must the summary.
    const at = (now: Date) =>
      summaryOf(loaded({ status: 'RESOLVED', resolvedAt: T(3) }, { departedAt: null }), REFERENCE, now)
    const s = at(NOW)
    expect(s.leftAt).toBe(T(3))
    expect(s.elapsedHours).toBe(6)
    expect(s.band).toBe('h6')
    expect(summaryText(s)).toContain(`Left ED: ${fmtStamp(T(3))}`)
    expect(summaryText(s)).not.toContain('still in the ED')
    // A day later it reads exactly the same: the stay ended when the case was resolved.
    const dayLater = at(new Date(NOW.getTime() + 24 * 3_600_000))
    expect(dayLater.leftAt).toBe(T(3))
    expect(dayLater.elapsedHours).toBe(6)
  })

  it('reads a reopened case as still in the ED, although it keeps its old departure time', () => {
    // `reopenCase` clears resolvedAt and leaves departedAt as entered (the prototype's reopen), so
    // an OPEN case can carry a departure time. Every clock in the app reads that as "still here".
    const s = summaryOf(loaded({ status: 'OPEN', resolvedAt: null }, { departedAt: T(2) }), REFERENCE, NOW)
    expect(s.leftAt).toBeNull()
    expect(s.elapsedHours).toBe(9)
    expect(s.band).toBe('h6')
    expect(summaryText(s)).toContain('Left ED: still in the ED')
  })

  it('lists the reasons with the primary first and marked, each under its stage', () => {
    const s = summaryOf(loaded(), REFERENCE, NOW)
    expect(s.reasons).toEqual([
      { name: 'Ward refuses handover', stageName: 'Admission process', primary: true, otherText: null },
      { name: 'Lab result delay', stageName: 'Investigations', primary: false, otherText: null },
      {
        name: 'Other',
        stageName: 'Investigations',
        primary: false,
        otherText: 'Analyser down since the night shift',
      },
    ])
    // The classification is the stages carried, distinct, in the order the reasons are listed.
    expect(s.stageNames).toEqual(['Admission process', 'Investigations'])
  })

  it('names the teams consulted', () => {
    expect(summaryOf(loaded(), REFERENCE, NOW).departments).toEqual(['Internal Medicine', 'General Surgery'])
  })

  it('counts the six deck categories from the tags and from the times the case records', () => {
    const s = summaryOf(loaded(), REFERENCE, NOW)
    expect(s.actions.map((a) => [a.name, a.count])).toEqual([
      // One tagged update plus the escalation time on the case.
      ['Leadership escalation', 2],
      // One tagged update plus the bed request time.
      ['Case / bed management', 2],
      ['External transfer / fax / RCC', 0],
      ['PRO / social work', 0],
      ['Forced / safety admission', 0],
      ['DAMA management', 0],
    ])
    // Six, not seven: "Update without an action tag" is not one of the deck's categories.
    expect(s.actions).toHaveLength(6)
  })

  it('counts a recorded transfer request as the external transfer category, once', () => {
    // No update carries the FAX_RCC tag here, so the one count is the transfer request time on
    // the case — the third timestamp `actionKindsOf` in kpi.ts reads as a documented action.
    const s = summaryOf(loaded({}, { transferRequestedAt: T(4) }), REFERENCE, NOW)
    expect(s.actions.map((a) => [a.name, a.count])).toContainEqual(['External transfer / fax / RCC', 1])
    expect(summaryText(s)).toContain('External transfer / fax / RCC ×1')
  })

  it('counts the updates and dates the newest, whatever order they arrived in', () => {
    const s = summaryOf(loaded(), REFERENCE, NOW)
    expect(s.updates).toEqual({ count: 3, lastAt: T(2) })
  })

  it('carries the outcome, the ward, the isolation flag and the review', () => {
    const s = summaryOf(
      loaded(
        { status: 'RESOLVED', review: { at: T(1), byName: 'Sami Supervisor' } },
        { disposition: 'ADMITTED', wardId: 'w-icu', isolation: true, departedAt: T(2) },
      ),
      REFERENCE,
      NOW,
    )
    expect(s.outcome).toEqual({
      dispositionLabel: 'Admitted',
      wardCode: 'ICU',
      isolation: true,
      reviewedByName: 'Sami Supervisor',
      reviewedAt: T(1),
    })
  })

  it('passes the loaded time sequence straight through', () => {
    expect(summaryOf(loaded(), REFERENCE, NOW).timeline.map((s) => s.label)).toEqual(['Registration', 'Triage'])
  })

  it('reads a blank working diagnosis as nothing recorded, not as an empty line', () => {
    expect(summaryOf(loaded({}, { diagnosis: '   ' }), REFERENCE, NOW).diagnosis).toBeNull()
  })
})

describe('summaryText', () => {
  const text = summaryText(summaryOf(loaded(), REFERENCE, NOW))

  it('is the deck row: one line per fact, the MRN in the first line', () => {
    expect(text.split('\n')[0]).toBe('Case summary — MRN 3100002')
    expect(text).toContain('CTAS: 3')
    expect(text).toContain('ED area: Rapid assessment zone')
    expect(text).toContain('Payer: Insured')
    expect(text).toContain('Working diagnosis: Chest pain, for admission')
    expect(text).toContain('Status: Open')
    expect(text).toContain('Left ED: still in the ED')
    expect(text).toContain('Time in the ED: 9h 00m (6 h or more)')
    expect(text).toContain('Classification: Admission process, Investigations')
  })

  it('marks the primary reason and carries the Other box beside its own reason', () => {
    expect(text).toContain('* Ward refuses handover (Admission process)')
    expect(text).toContain('- Lab result delay (Investigations)')
    expect(text).toContain('- Other (Investigations) — Analyser down since the night shift')
  })

  it('names the teams, the documented actions and the update count', () => {
    expect(text).toContain('Teams: Internal Medicine, General Surgery')
    expect(text).toContain('Documented actions: Leadership escalation ×2, Case / bed management ×2')
    expect(text).toContain('Updates: 3, last ')
  })

  it('ends with the time sequence, each step with the gap from the one before it', () => {
    expect(text).toContain('Time sequence:')
    expect(text).toContain('Registration')
    expect(text).toMatch(/Triage\s+\+0h 30m/)
  })

  it('carries no update text and no resolution note — the rule the whole module exists for', () => {
    const withNote = summaryText(
      summaryOf(
        loaded({ status: 'RESOLVED' }, { resolutionNote: 'Handed over to Dr Khaled for Mr Ali', departedAt: T(2) }),
        REFERENCE,
        NOW,
      ),
    )
    for (const secret of ['Mrs Smith', 'Rang the ward', 'Escalated to medical admin', 'Still waiting', 'Dr Khaled']) {
      expect(withNote).not.toContain(secret)
      expect(text).not.toContain(secret)
    }
    expect(JSON.stringify(summaryOf(loaded(), REFERENCE, NOW))).not.toContain('Mrs Smith')
  })

  it('says so plainly when a case carries nothing but its registration', () => {
    const bare = summaryText(
      summaryOf(
        loaded(
          { updates: [], timeline: [{ key: 'registrationAt', label: 'Registration', at: T(1), fromPrevious: null }] },
          {
            ctas: null,
            areaId: null,
            payer: null,
            diagnosis: '',
            reasons: [],
            primaryReasonId: null,
            consults: [],
            bedRequestedAt: null,
            medAdminInformedAt: null,
          },
        ),
        REFERENCE,
        NOW,
      ),
    )
    expect(bare).not.toContain('CTAS')
    expect(bare).not.toContain('Payer')
    expect(bare).toContain('Classification: none recorded')
    expect(bare).toContain('- no reason recorded')
    expect(bare).toContain('Teams: none')
    expect(bare).toContain('Documented actions: none')
    expect(bare).toContain('Updates: 0')
  })
})
