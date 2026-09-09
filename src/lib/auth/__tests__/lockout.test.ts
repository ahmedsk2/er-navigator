import { describe, expect, it } from 'vitest'
import {
  isLocked,
  LOCKOUT_MINUTES,
  lockMinutesRemaining,
  MAX_FAILED_LOGINS,
  registerFailure,
} from '@/src/lib/auth/lockout'

const now = new Date('2026-09-09T10:00:00.000Z')
const minutes = (n: number) => new Date(now.getTime() + n * 60_000)

describe('lockout policy', () => {
  it('locks after ten failures, for fifteen minutes', () => {
    expect(MAX_FAILED_LOGINS).toBe(10)
    expect(LOCKOUT_MINUTES).toBe(15)
  })

  it('counts failures one at a time without locking below the limit', () => {
    for (let before = 0; before < MAX_FAILED_LOGINS - 1; before += 1) {
      const result = registerFailure(before, now)
      expect(result.locked).toBe(false)
      expect(result.failedLogins).toBe(before + 1)
      expect(result.lockedUntil).toBeNull()
    }
  })

  it('locks on the tenth failure and clears the counter so the next lock costs ten more', () => {
    const result = registerFailure(MAX_FAILED_LOGINS - 1, now)
    expect(result.locked).toBe(true)
    expect(result.failedLogins).toBe(0)
    expect(result.lockedUntil).toEqual(minutes(LOCKOUT_MINUTES))
  })

  it('walks a full run of ten failures from zero and locks exactly once', () => {
    let counter = 0
    const locks: Date[] = []
    for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt += 1) {
      const result = registerFailure(counter, now)
      counter = result.failedLogins
      if (result.lockedUntil) locks.push(result.lockedUntil)
    }
    expect(locks).toHaveLength(1)
    expect(locks[0]).toEqual(minutes(15))
  })

  it('reads a lock as active until the instant it expires', () => {
    expect(isLocked(minutes(1), now)).toBe(true)
    expect(isLocked(minutes(0), now)).toBe(false)
    expect(isLocked(minutes(-1), now)).toBe(false)
    expect(isLocked(null, now)).toBe(false)
    expect(isLocked(undefined, now)).toBe(false)
  })

  it('rounds the remaining wait up so the message never says zero minutes', () => {
    expect(lockMinutesRemaining(minutes(15), now)).toBe(15)
    expect(lockMinutesRemaining(minutes(14.2), now)).toBe(15)
    expect(lockMinutesRemaining(new Date(now.getTime() + 1_000), now)).toBe(1)
    expect(lockMinutesRemaining(minutes(-1), now)).toBe(0)
    expect(lockMinutesRemaining(null, now)).toBe(0)
  })
})
