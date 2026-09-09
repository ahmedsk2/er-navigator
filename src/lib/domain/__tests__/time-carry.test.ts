import { describe, expect, it } from 'vitest'
import { fmtHours, spokenHours, splitHours } from '../time'

/**
 * Final review C14: 6.9944 h is 6 h 59.67 min, which rounds to 60 min. Without the carry the
 * board, the case editor's headline clock, the handover sheet and the alert email all showed
 * "6h 60m" for about thirty seconds of every hour.
 */
describe('minute rounding carries into the hour', () => {
  it('splits with the carry', () => {
    expect(splitHours(6.9944)).toEqual({ hh: 7, mm: 0 })
    expect(splitHours(6.995)).toEqual({ hh: 7, mm: 0 })
    expect(splitHours(0.9999)).toEqual({ hh: 1, mm: 0 })
    expect(splitHours(6.99)).toEqual({ hh: 6, mm: 59 })
    expect(splitHours(6.0833)).toEqual({ hh: 6, mm: 5 })
    expect(splitHours(0)).toEqual({ hh: 0, mm: 0 })
  })

  it('never renders sixty minutes', () => {
    expect(fmtHours(6.9944)).toBe('7h 00m')
    expect(fmtHours(23.9999)).toBe('24h 00m')
    expect(spokenHours(6.9944)).toBe('7 hours')
    expect(spokenHours(0.9999)).toBe('1 hour')
    for (let seconds = 0; seconds < 3600; seconds += 1) {
      const text = fmtHours(5 + seconds / 3600)
      expect(text, `${seconds}s`).not.toContain('60m')
    }
  })
})
