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
