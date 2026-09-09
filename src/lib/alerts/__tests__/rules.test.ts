import { describe, expect, it } from 'vitest'
import { emailsAt, thresholdsDue, thresholdUpdateText } from '../rules'

const HOUR = 36e5
const NOW = new Date('2026-09-09T12:00:00.000Z')

function openCase(hoursAgo: number) {
  return {
    status: 'OPEN' as const,
    registrationAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    departedAt: null,
    resolvedAt: null,
  }
}

describe('thresholdsDue', () => {
  it('fires nothing before four hours', () => {
    expect(thresholdsDue(openCase(3.99), [], NOW)).toEqual([])
  })

  it('fires exactly at the threshold, not a minute before', () => {
    expect(thresholdsDue(openCase(4), [], NOW)).toEqual([4])
    expect(thresholdsDue(openCase(3.9999), [], NOW)).toEqual([])
  })

  it('catches up on every threshold a case has already passed', () => {
    expect(thresholdsDue(openCase(25), [], NOW)).toEqual([4, 6, 12, 24])
  })

  it('skips the thresholds that already have an Alert row', () => {
    expect(thresholdsDue(openCase(13), [4, 6], NOW)).toEqual([12])
    expect(thresholdsDue(openCase(13), [4, 6, 12], NOW)).toEqual([])
  })

  it('fires nothing for a resolved or voided case, whatever its stay was', () => {
    const stay = {
      registrationAt: new Date(NOW.getTime() - 30 * HOUR),
      departedAt: new Date(NOW.getTime() - 1 * HOUR),
      resolvedAt: new Date(NOW.getTime() - 1 * HOUR),
    }
    expect(thresholdsDue({ status: 'RESOLVED', ...stay }, [], NOW)).toEqual([])
    expect(thresholdsDue({ status: 'VOIDED', ...stay }, [], NOW)).toEqual([])
  })

  it('fires nothing when the registration time is in the future', () => {
    expect(
      thresholdsDue(
        { status: 'OPEN', registrationAt: new Date(NOW.getTime() + HOUR), departedAt: null, resolvedAt: null },
        [],
        NOW,
      ),
    ).toEqual([])
  })
})

describe('emailsAt', () => {
  it('emails from six hours up and not at four', () => {
    expect(emailsAt(4)).toBe(false)
    expect(emailsAt(6)).toBe(true)
    expect(emailsAt(12)).toBe(true)
    expect(emailsAt(24)).toBe(true)
  })
})

describe('thresholdUpdateText', () => {
  it('is the wording the plan specifies', () => {
    expect(thresholdUpdateText(12)).toBe('Reached 12h threshold')
  })
})
