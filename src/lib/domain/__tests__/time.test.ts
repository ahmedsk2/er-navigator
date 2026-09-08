import { describe, expect, it } from 'vitest'
import { band, duration, elapsedHours, endAt, fmtHours, median, MIN_N } from '../time'

const t = (h: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, 0) + h * 36e5)

describe('duration', () => {
  it('returns hours between two dates', () => expect(duration(t(0), t(6.5))).toBe(6.5))
  it('is null when either side is missing', () => {
    expect(duration(null, t(1))).toBeNull()
    expect(duration(t(1), undefined)).toBeNull()
  })
  it('is null (never negative) when out of order', () => expect(duration(t(2), t(1))).toBeNull())
  it('is 0 for identical instants', () => expect(duration(t(1), t(1))).toBe(0))
})

describe('endAt / elapsedHours', () => {
  it('OPEN case has no end and counts to now', () => {
    const c = { status: 'OPEN' as const, registrationAt: t(0) }
    expect(endAt(c)).toBeNull()
    expect(elapsedHours(c, t(7))).toBe(7)
  })
  it('RESOLVED prefers departedAt over resolvedAt', () => {
    const c = { status: 'RESOLVED' as const, registrationAt: t(0), departedAt: t(8), resolvedAt: t(9) }
    expect(elapsedHours(c, t(20))).toBe(8)
  })
  it('RESOLVED falls back to resolvedAt', () => {
    const c = { status: 'RESOLVED' as const, registrationAt: t(0), resolvedAt: t(9) }
    expect(elapsedHours(c, t(20))).toBe(9)
  })
  it('VOIDED has no end (voided cases are excluded upstream)', () => {
    const c = { status: 'VOIDED' as const, registrationAt: t(0) }
    expect(endAt(c)).toBeNull()
  })
})

describe('band thresholds are inclusive at 4/6/12/24', () => {
  it.each([
    [null, 'ok'],
    [0, 'ok'],
    [3.99, 'ok'],
    [4, 'h4'],
    [5.99, 'h4'],
    [6, 'h6'],
    [11.99, 'h6'],
    [12, 'h12'],
    [23.99, 'h12'],
    [24, 'h24'],
    [100, 'h24'],
  ] as const)('band(%s) = %s', (h, expected) => expect(band(h)).toBe(expected))
})

describe('median', () => {
  it('ignores nulls and NaN', () => expect(median([3, null, 1, undefined, Number.NaN, 2])).toBe(2))
  it('averages the middle pair for even n', () => expect(median([4, 1, 3, 2])).toBe(2.5))
  it('is null when empty', () => expect(median([null, undefined])).toBeNull())
  it('MIN_N is 3', () => expect(MIN_N).toBe(3))
})

describe('fmtHours', () => {
  it('formats hours and zero-padded minutes', () => expect(fmtHours(6.0833)).toBe('6h 05m'))
  it('renders a dash for null', () => expect(fmtHours(null)).toBe('–'))
})
