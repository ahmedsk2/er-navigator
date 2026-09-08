import { describe, expect, it } from 'vitest'
import { DEPARTMENTS, STAGES, WARDS } from '../taxonomy'

describe('seed taxonomy matches Appendix A', () => {
  it('has the ten stages in order', () =>
    expect(STAGES.map((s) => s.code)).toEqual([
      'reg',
      'triage',
      'resus',
      'exam',
      'inv',
      'ref',
      'dispo',
      'adm',
      'dc',
      'admin',
    ]))

  it('every referral reason requires a department', () =>
    expect(STAGES.find((s) => s.code === 'ref')!.reasons.every((r) => r.requiresDepartment)).toBe(true))

  it('exactly three admission reasons require a referral number', () =>
    expect(STAGES.find((s) => s.code === 'adm')!.reasons.filter((r) => r.requiresReferralNo)).toHaveLength(3))

  it('no seed reason is literally "Other" (added per stage at seed time)', () =>
    expect(STAGES.flatMap((s) => s.reasons).some((r) => r.name === 'Other')).toBe(false))

  it('has 38 seed reasons across the ten stages', () =>
    expect(STAGES.reduce((n, s) => n + s.reasons.length, 0)).toBe(38))

  it('has 16 departments ending in Other and 8 wards', () => {
    expect(DEPARTMENTS).toHaveLength(16)
    expect(DEPARTMENTS.at(-1)).toBe('Other')
    expect(WARDS).toHaveLength(8)
  })
})
