import { describe, expect, it } from 'vitest'
import { buildCaseSchemas, mrnSchema, phiWarnings, updateTextSchema, voidSchema } from '../validation'

const NOW = new Date('2026-09-08T12:00:00Z')
const meta = new Map([
  ['r-bed', { requiresDepartment: false, requiresReferralNo: false, isOther: false }],
  ['r-consult', { requiresDepartment: true, requiresReferralNo: false, isOther: false }],
  ['r-refout', { requiresDepartment: false, requiresReferralNo: true, isOther: false }],
  ['r-other', { requiresDepartment: false, requiresReferralNo: false, isOther: true }],
])
const { draft, resolve } = buildCaseSchemas(meta, () => NOW)

const base = () => ({
  mrn: '851557',
  registrationAt: new Date('2026-09-08T06:00:00Z'),
  reasons: [{ reasonId: 'r-bed' }],
  version: 1,
})

const issues = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`)

describe('mrn', () => {
  it('accepts digits of any length and trims', () => expect(mrnSchema.parse('  0042 ')).toBe('0042'))
  it.each(['', 'A123', '12 34', '12-34'])('rejects %j', (v) => expect(mrnSchema.safeParse(v).success).toBe(false))
})

describe('case draft rules (locked plan section 4)', () => {
  it('accepts a minimal valid draft', () => expect(draft.safeParse(base()).success).toBe(true))

  it('requires at least one reason', () => {
    expect(issues(draft.safeParse({ ...base(), reasons: [] }))).toContain('reasons: Select at least one delay reason.')
  })

  it('rejects a registration time in the future', () => {
    expect(issues(draft.safeParse({ ...base(), registrationAt: new Date('2026-09-08T13:00:00Z') }))).toContain(
      'registrationAt: Registration time cannot be in the future.',
    )
  })

  it('requires a primary reason when more than one reason is selected', () => {
    const r = draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-bed' }, { reasonId: 'r-refout' }] })
    expect(issues(r)).toContain('primaryReasonId: Choose the primary reason.')
  })

  it('the primary must be one of the selected reasons', () => {
    const r = draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-bed' }, { reasonId: 'r-refout' }], primaryReasonId: 'r-other' })
    expect(issues(r)).toContain('primaryReasonId: The primary reason must be one of the selected reasons.')
  })

  it('a reason that requires a department needs a consult row', () => {
    const r = draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-consult' }] })
    expect(issues(r)).toContain('consults: Add the consulted team for this reason.')
    const ok = draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-consult' }], consults: [{ departmentId: 'd-icu' }] })
    expect(ok.success).toBe(true)
  })

  it('an Other reason needs its text', () => {
    expect(issues(draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-other' }] }))).toContain('reasons.0.otherText: Describe the other reason.')
    expect(draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-other', otherText: 'Family not answering' }] }).success).toBe(true)
  })

  it('rejects unknown reason ids and duplicates', () => {
    expect(issues(draft.safeParse({ ...base(), reasons: [{ reasonId: 'nope' }] }))).toContain('reasons: Unknown delay reason.')
    expect(issues(draft.safeParse({ ...base(), reasons: [{ reasonId: 'r-bed' }, { reasonId: 'r-bed' }], primaryReasonId: 'r-bed' }))).toContain(
      'reasons: A reason is selected twice.',
    )
  })

  it('accepts ISO strings for times and coerces them', () => {
    const r = draft.safeParse({ ...base(), registrationAt: '2026-09-08T06:00:00+03:00', triageAt: '2026-09-08T06:30:00Z' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.triageAt).toBeInstanceOf(Date)
  })
})

describe('resolve rules', () => {
  const resolved = () => ({ ...base(), departedAt: new Date('2026-09-08T11:00:00Z') })

  it('requires a disposition', () => {
    expect(resolve.safeParse(resolved()).success).toBe(false)
  })

  it('ADMITTED requires a ward', () => {
    expect(issues(resolve.safeParse({ ...resolved(), disposition: 'ADMITTED' }))).toContain('wardId: Choose the ward.')
    expect(resolve.safeParse({ ...resolved(), disposition: 'ADMITTED', wardId: 'w-fmw' }).success).toBe(true)
  })

  it('TRANSFERRED requires a referral tracking number', () => {
    expect(issues(resolve.safeParse({ ...resolved(), disposition: 'TRANSFERRED' }))).toContain('referralTrackingNo: Enter the referral tracking number.')
    expect(resolve.safeParse({ ...resolved(), disposition: 'TRANSFERRED', referralTrackingNo: 'RCC-48213' }).success).toBe(true)
  })

  it('a referred-out reason requires the tracking number on resolve, whatever the disposition', () => {
    const r = resolve.safeParse({ ...resolved(), reasons: [{ reasonId: 'r-refout' }], disposition: 'DISCHARGED_HOME' })
    expect(issues(r)).toContain('referralTrackingNo: Enter the referral tracking number.')
  })
})

describe('free text and identifiers', () => {
  it('updates need text and are capped', () => {
    expect(updateTextSchema.safeParse('   ').success).toBe(false)
    expect(updateTextSchema.safeParse('x'.repeat(1001)).success).toBe(false)
  })
  it('void needs a reason', () => expect(voidSchema.safeParse({ version: 2, voidReason: 'no' }).success).toBe(false))
  it('warns on a 10-digit run and never blocks', () => {
    expect(phiWarnings('Update', 'called 0501234567 for pickup')).toHaveLength(1)
    expect(phiWarnings('Update', 'MRN 851557, bed 12')).toEqual([])
    expect(phiWarnings('Update', '12345678901')).toEqual([]) // 11 digits is not the 10-digit shape
    expect(phiWarnings('Update', null)).toEqual([])
  })
})
