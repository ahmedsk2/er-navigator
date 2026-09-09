import { describe, expect, it } from 'vitest'
import { timelineOf, type TimelineSource } from '../timeline'

/**
 * The wire shape of the per-case time sequence. The ordering and the intervals are `timeline()`'s
 * and are tested against its own fixture in `src/lib/domain/__tests__/kpi.test.ts`; what this
 * checks is the part that is this module's own: that a caller which has the milestones but not
 * the CTAS, the ward or the update count can build a timeline without inventing any of them, and
 * that every instant crosses the wire as an ISO-8601 string.
 */
const NOW = new Date('2026-09-09T12:00:00.000Z')
const T = (hoursBeforeNow: number): Date => new Date(NOW.getTime() - hoursBeforeNow * 3_600_000)

function source(over: Partial<TimelineSource> = {}): TimelineSource {
  return {
    status: 'OPEN',
    registrationAt: T(8),
    departedAt: null,
    resolvedAt: null,
    triageAt: null,
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    medAdminInformedAt: null,
    consults: [],
    investigations: [],
    ...over,
  }
}

describe('timelineOf', () => {
  it('is the registration alone for a case with nothing else recorded', () => {
    const steps = timelineOf(source())
    expect(steps).toEqual([
      { key: 'registrationAt', label: 'Registration', at: T(8).toISOString(), fromPrevious: null },
    ])
  })

  it('orders every recorded step and measures the gap from the one before it', () => {
    const steps = timelineOf(
      source({
        status: 'RESOLVED',
        registrationAt: T(6),
        triageAt: T(5.75),
        physicianAt: T(5),
        decisionAt: T(2),
        departedAt: T(1),
        consults: [{ departmentName: 'Internal Medicine', consultedAt: T(4), seenAt: T(3), repliedAt: null }],
        investigations: [
          {
            type: 'CT',
            orderedAt: T(4.5),
            collectedAt: null,
            receivedAt: null,
            doneAt: T(3.5),
            preliminaryAt: T(3.25),
            resultedAt: null,
          },
        ],
      }),
    )
    expect(steps.map((s) => s.label)).toEqual([
      'Registration',
      'Triage',
      'First physician contact',
      'CT: ordered',
      'Internal Medicine: consulted',
      'CT: scan done',
      'CT: preliminary report',
      'Internal Medicine: seen patient',
      'Disposition decided',
      'Left ED',
    ])
    expect(steps[0]!.fromPrevious).toBeNull()
    expect(steps[1]!.fromPrevious).toBeCloseTo(0.25, 10)
    expect(steps.at(-1)!.fromPrevious).toBe(1)
    // Every key is unique, so React can list them and the print sheet can key its spans.
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length)
  })

  it('carries every instant as an ISO-8601 string, because this crosses fetch and the RSC boundary', () => {
    const steps = timelineOf(source({ triageAt: T(7) }))
    expect(steps.map((s) => s.at)).toEqual([T(8).toISOString(), T(7).toISOString()])
    expect(steps.every((s) => typeof s.at === 'string')).toBe(true)
  })
})
