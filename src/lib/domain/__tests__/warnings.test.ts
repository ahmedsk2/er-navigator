import { describe, expect, it } from 'vitest'
import { timeWarnings } from '../warnings'

const t = (h: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, 0) + h * 36e5)

describe('timeWarnings (prototype port)', () => {
  it('is empty when everything is in order', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        triageAt: t(0.5),
        roomAt: t(1),
        physicianAt: t(1.5),
        decisionAt: t(4),
        departedAt: t(8),
        admOrderAt: t(4.5),
        bedRequestedAt: t(5),
        bedAssignedAt: t(7),
        handoverAt: t(7.5),
        consults: [{ departmentName: 'ICU', consultedAt: t(2), seenAt: t(3), repliedAt: t(3.5) }],
        investigations: [{ type: 'LAB', orderedAt: t(1), collectedAt: t(1.2), receivedAt: t(1.5), resultedAt: t(3) }],
      }),
    ).toEqual([])
  })

  it('flags a milestone before registration with the prototype wording', () => {
    expect(timeWarnings({ registrationAt: t(2), triageAt: t(1) })).toEqual(['Triage is before registration'])
  })

  it('flags room before triage', () => {
    expect(timeWarnings({ registrationAt: t(0), triageAt: t(2), roomAt: t(1) })).toContain('room is before triage')
  })

  it('flags consult order per team', () => {
    const w = timeWarnings({ registrationAt: t(0), consults: [{ departmentName: 'MROD', consultedAt: t(3), seenAt: t(2), repliedAt: t(1) }] })
    expect(w).toEqual(['MROD seen is before MROD consulted', 'MROD replied is before MROD seen'])
  })

  it('flags investigation step order using the type labels', () => {
    const w = timeWarnings({ registrationAt: t(0), investigations: [{ type: 'CT', orderedAt: t(2), doneAt: t(1), resultedAt: t(3) }] })
    expect(w).toEqual(['CT scan done is before CT ordered'])
  })

  /**
   * Phase 8. The verbal report belongs between the scan and the official one, so an official
   * report typed in before the preliminary one is out of order — a warning, never a refused save,
   * because that is exactly the sequence a busy radiologist can enter backwards.
   */
  it('flags an official report entered before the preliminary one, and only warns', () => {
    const w = timeWarnings({
      registrationAt: t(0),
      investigations: [{ type: 'CT', orderedAt: t(1), doneAt: t(2), preliminaryAt: t(4), resultedAt: t(3) }],
    })
    expect(w).toEqual(['CT reported is before CT preliminary report'])
  })

  it('says nothing about a preliminary report in its proper place, or a lab row without one', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [
          { type: 'US', orderedAt: t(1), doneAt: t(2), preliminaryAt: t(2.5), resultedAt: t(4) },
          { type: 'LAB', orderedAt: t(1), collectedAt: t(1.2), receivedAt: t(1.5), resultedAt: t(3) },
        ],
      }),
    ).toEqual([])
  })

  it('flags a preliminary report entered before the scan was done', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [{ type: 'XR', orderedAt: t(1), doneAt: t(3), preliminaryAt: t(2) }],
      }),
    ).toEqual(['X-ray / KUB preliminary report is before X-ray / KUB done'])
  })

  it('still flags a report before the scan when no preliminary report was entered (Phase 8 review C2)', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [{ type: 'CT', orderedAt: t(1), doneAt: t(5), preliminaryAt: null, resultedAt: t(3) }],
      }),
    ).toEqual(['CT reported is before CT scan done'])
  })

  it('compares each recorded step with the last recorded one, whatever is missing between them', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [{ type: 'CT', orderedAt: t(5), doneAt: null, preliminaryAt: null, resultedAt: t(3) }],
      }),
    ).toEqual(['CT reported is before CT ordered'])
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [{ type: 'LAB', orderedAt: t(1), collectedAt: null, receivedAt: t(4), resultedAt: t(3) }],
      }),
    ).toEqual(['Lab resulted is before Lab received by lab'])
  })

  /**
   * Phase 8b. The painkiller time is where Adaa KPI 8 stops and the registration is where it
   * starts, so one before the other would make the KPI negative; the case-management pair is a
   * call and its answer. Both warn, like every other pair here — the save is never refused.
   */
  it('flags a painkiller given before the registration', () => {
    expect(timeWarnings({ registrationAt: t(3), painkillerAt: t(1) })).toEqual([
      'Painkiller given is before registration',
    ])
    expect(timeWarnings({ registrationAt: t(1), painkillerAt: t(3) })).toEqual([])
    // Both ends must be recorded; one alone says nothing.
    expect(timeWarnings({ registrationAt: t(1), painkillerAt: null })).toEqual([])
  })

  it('flags a case-management reply before the call, and says nothing about the pair in order', () => {
    expect(timeWarnings({ registrationAt: t(0), caseMgmtCalledAt: t(4), caseMgmtRepliedAt: t(2) })).toEqual([
      'case management replied is before case management called',
    ])
    expect(timeWarnings({ registrationAt: t(0), caseMgmtCalledAt: t(2), caseMgmtRepliedAt: t(4) })).toEqual([])
    expect(timeWarnings({ registrationAt: t(0), caseMgmtRepliedAt: t(4) })).toEqual([])
  })

  it('reports the painkiller and the case-management pair together, in that order', () => {
    expect(
      timeWarnings({ registrationAt: t(2), painkillerAt: t(1), caseMgmtCalledAt: t(5), caseMgmtRepliedAt: t(3) }),
    ).toEqual([
      'Painkiller given is before registration',
      'case management replied is before case management called',
    ])
  })

  it('flags an MRI step out of order with the MRI label (Phase 8b)', () => {
    expect(
      timeWarnings({
        registrationAt: t(0),
        investigations: [{ type: 'MRI', orderedAt: t(1), doneAt: t(4), preliminaryAt: t(3) }],
      }),
    ).toEqual(['MRI preliminary report is before MRI scan done'])
  })

  it('flags the admission and transfer chains', () => {
    const w = timeWarnings({ registrationAt: t(0), admOrderAt: t(5), bedRequestedAt: t(4), transferRequestedAt: t(6), transferAcceptedAt: t(5.5) })
    expect(w).toEqual(['bed requested (fax sent) is before admission order written', 'accepted by facility is before transfer requested'])
  })

  it('ignores missing values and unparsable strings', () => {
    expect(timeWarnings({ registrationAt: 'not a date', triageAt: t(1) })).toEqual([])
    expect(timeWarnings({ registrationAt: t(1), triageAt: null, roomAt: undefined })).toEqual([])
  })

  it('accepts ISO strings as well as Dates', () => {
    expect(timeWarnings({ registrationAt: t(2).toISOString(), triageAt: t(1).toISOString() })).toEqual(['Triage is before registration'])
  })
})
