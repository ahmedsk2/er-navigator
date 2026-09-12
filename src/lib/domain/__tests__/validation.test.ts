import { describe, expect, it } from 'vitest'
import {
  buildCaseSchemas,
  DIAGNOSIS_MAX,
  mrnSchema,
  NOTE_MAX,
  OTHER_TEXT_MAX,
  phiWarnings,
  UPDATE_TEXT_MAX,
  updateActionSchema,
  updateTextSchema,
  voidSchema,
} from '../validation'

const NOW = new Date('2026-09-08T12:00:00Z')
const meta = new Map([
  ['r-bed', { requiresDepartment: false, requiresReferralNo: false, isOther: false }],
  ['r-consult', { requiresDepartment: true, requiresReferralNo: false, isOther: false }],
  ['r-refout', { requiresDepartment: false, requiresReferralNo: true, isOther: false }],
  ['r-other', { requiresDepartment: false, requiresReferralNo: false, isOther: true }],
])
/**
 * The ED areas this "request" knows (Phase 8). `caseSchemas(reference)` builds exactly this set
 * from the request's reference data: the active areas for a new case, and for an existing one the
 * active areas plus the single retired area that case already carries.
 */
const ACTIVE_AREA = 'a-resus'
const RETIRED_ON_THIS_CASE = 'a-oldpool'
const OTHER_RETIRED_AREA = 'a-gone'

const { draft, resolve } = buildCaseSchemas(meta, () => NOW, new Set([ACTIVE_AREA]))
/** What `loadReferenceForCase` produces for a case that carries a since-deactivated area. */
const forCarrier = buildCaseSchemas(meta, () => NOW, new Set([ACTIVE_AREA, RETIRED_ON_THIS_CASE]))

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

  // --- Phase 8: CTAS and the ED area ----------------------------------------------------------

  it('accepts CTAS 1 to 5, and null or absent for "not recorded"', () => {
    for (const ctas of [1, 2, 3, 4, 5]) {
      expect(draft.safeParse({ ...base(), ctas }).success, `CTAS ${ctas}`).toBe(true)
    }
    expect(draft.safeParse({ ...base(), ctas: null }).success).toBe(true)
    expect(draft.safeParse(base()).success).toBe(true)
  })

  it('rejects a CTAS outside 1 to 5, and a fractional one', () => {
    for (const ctas of [0, 6, -1, 2.5]) {
      expect(issues(draft.safeParse({ ...base(), ctas })), `CTAS ${ctas}`).toContain(
        'ctas: CTAS is a whole number from 1 to 5.',
      )
    }
  })

  it('accepts an ED area this request knows and refuses one it does not', () => {
    expect(draft.safeParse({ ...base(), areaId: ACTIVE_AREA }).success).toBe(true)
    expect(draft.safeParse({ ...base(), areaId: null }).success).toBe(true)
    expect(issues(draft.safeParse({ ...base(), areaId: OTHER_RETIRED_AREA }))).toContain(
      'areaId: That ED area is no longer on the list.',
    )
  })

  /**
   * The Phase 7 retired-row rule, applied to areas: an area an Admin deactivated is still
   * accepted on the case that already carries it (its schema was built from
   * `loadReferenceForCase`), and still refused everywhere else.
   */
  // --- Phase 10: the working diagnosis and the payer -------------------------------------------

  it('accepts a working diagnosis of 80 characters and refuses 81', () => {
    expect(draft.safeParse({ ...base(), diagnosis: 'x'.repeat(80) }).success).toBe(true)
    expect(issues(draft.safeParse({ ...base(), diagnosis: 'x'.repeat(81) }))[0]).toMatch(/^diagnosis: /)
    // Blank, null and absent are all "not recorded"; nothing here can refuse a save on its own.
    expect(draft.safeParse({ ...base(), diagnosis: '' }).success).toBe(true)
    expect(draft.safeParse({ ...base(), diagnosis: null }).success).toBe(true)
    expect(draft.safeParse(base()).success).toBe(true)
  })

  it('trims the working diagnosis, as every free text is trimmed', () => {
    const parsed = draft.parse({ ...base(), diagnosis: '  chest pain, for admission  ' })
    expect(parsed.diagnosis).toBe('chest pain, for admission')
  })

  it('accepts the three payers, and null or absent for "not recorded"', () => {
    for (const payer of ['GOVERNMENT', 'INSURED', 'SELF_PAY']) {
      expect(draft.safeParse({ ...base(), payer }).success, payer).toBe(true)
    }
    expect(draft.safeParse({ ...base(), payer: null }).success).toBe(true)
    expect(draft.safeParse(base()).success).toBe(true)
  })

  it('refuses a payer outside the enum', () => {
    for (const payer of ['PRIVATE', 'government', '']) {
      expect(issues(draft.safeParse({ ...base(), payer })).join(' '), payer).toContain('payer')
    }
  })

  it('accepts a retired area on the case that carries it, and nowhere else', () => {
    expect(forCarrier.draft.safeParse({ ...base(), areaId: RETIRED_ON_THIS_CASE }).success).toBe(true)
    expect(issues(draft.safeParse({ ...base(), areaId: RETIRED_ON_THIS_CASE }))).toContain(
      'areaId: That ED area is no longer on the list.',
    )
    // And the same rule holds on resolve, which is built from the same refinements. The journey
    // times are the ones a discharge home needs since Phase 13, so the only issue is the area's.
    const resolved = {
      ...base(),
      triageAt: new Date('2026-09-08T06:20:00Z'),
      physicianAt: new Date('2026-09-08T07:00:00Z'),
      decisionAt: new Date('2026-09-08T09:00:00Z'),
      departedAt: new Date('2026-09-08T11:00:00Z'),
      disposition: 'DISCHARGED_HOME',
    }
    expect(forCarrier.resolve.safeParse({ ...resolved, areaId: RETIRED_ON_THIS_CASE }).success).toBe(true)
    expect(issues(resolve.safeParse({ ...resolved, areaId: RETIRED_ON_THIS_CASE }))).toContain(
      'areaId: That ED area is no longer on the list.',
    )
  })

  it('takes an optional preliminary report time on an investigation row', () => {
    const r = draft.safeParse({
      ...base(),
      investigations: [{ type: 'CT', doneAt: '2026-09-08T07:00:00Z', preliminaryAt: '2026-09-08T07:30:00Z' }],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.investigations[0]!.preliminaryAt).toBeInstanceOf(Date)
    // A lab row simply never sends one.
    expect(draft.safeParse({ ...base(), investigations: [{ type: 'LAB' }] }).success).toBe(true)
  })

  it('takes an MRI investigation row, like the other three imaging types (Phase 8b)', () => {
    const r = draft.safeParse({
      ...base(),
      investigations: [
        { type: 'MRI', orderedAt: '2026-09-08T07:00:00Z', doneAt: '2026-09-08T08:00:00Z', preliminaryAt: '2026-09-08T08:30:00Z' },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.investigations[0]!.type).toBe('MRI')
    expect(draft.safeParse({ ...base(), investigations: [{ type: 'PET' }] }).success).toBe(false)
  })

  // --- Phase 8b: Ahmed's collection decisions -------------------------------------------------

  describe('pain management (decision F, Adaa KPI 8)', () => {
    it('takes Yes or No and refuses "Not sure", which the national form has no column for', () => {
      for (const answer of ['YES', 'NO']) {
        expect(draft.safeParse({ ...base(), painkillerPrescribed: answer }).success, answer).toBe(true)
        expect(draft.safeParse({ ...base(), sickleCellTreatment: answer }).success, answer).toBe(true)
      }
      expect(draft.safeParse({ ...base(), painkillerPrescribed: 'NOT_SURE' }).success).toBe(false)
      expect(draft.safeParse({ ...base(), pethidinePrescribed: 'NOT_SURE' }).success).toBe(false)
      expect(draft.safeParse({ ...base(), sickleCellTreatment: 'NOT_SURE' }).success).toBe(false)
      // Absent and null are both "not recorded".
      expect(draft.safeParse({ ...base(), painkillerPrescribed: null }).success).toBe(true)
      expect(draft.safeParse(base()).success).toBe(true)
    })

    it('takes a pethidine dose of 50, 100 or 150 and nothing else', () => {
      for (const dose of [50, 100, 150]) {
        expect(
          draft.safeParse({ ...base(), pethidinePrescribed: 'YES', pethidineDoseMg: dose }).success,
          `${dose} mg`,
        ).toBe(true)
      }
      for (const dose of [0, 25, 75, 200, 100.5]) {
        expect(
          issues(draft.safeParse({ ...base(), pethidinePrescribed: 'YES', pethidineDoseMg: dose })),
          `${dose} mg`,
        ).toContain('pethidineDoseMg: The pethidine dose is 50, 100 or 150 mg.')
      }
    })

    it('refuses a dose without a pethidine YES, and a painkiller time without a painkiller YES', () => {
      for (const prescribed of [undefined, null, 'NO']) {
        expect(
          issues(draft.safeParse({ ...base(), pethidinePrescribed: prescribed, pethidineDoseMg: 100 })),
          String(prescribed),
        ).toContain('pethidineDoseMg: Record the pethidine dose only when pethidine was prescribed.')
        expect(
          issues(draft.safeParse({ ...base(), painkillerPrescribed: prescribed, painkillerAt: '2026-09-08T07:00:00Z' })),
          String(prescribed),
        ).toContain('painkillerAt: Record when the painkiller was given only when one was prescribed.')
      }
      const ok = draft.safeParse({
        ...base(),
        painkillerPrescribed: 'YES',
        painkillerAt: '2026-09-08T07:00:00Z',
        pethidinePrescribed: 'YES',
        pethidineDoseMg: 50,
      })
      expect(ok.success).toBe(true)
    })
  })

  it('takes the three-answer discharge questions, "Not sure" included (decision D)', () => {
    for (const answer of ['YES', 'NO', 'NOT_SURE']) {
      expect(draft.safeParse({ ...base(), instructionsGiven: answer, familyEngagement: answer }).success, answer).toBe(
        true,
      )
    }
    expect(draft.safeParse({ ...base(), instructionsGiven: 'MAYBE' }).success).toBe(false)
  })

  it('takes the case-management vocabularies and refuses anything else (decision B)', () => {
    const ok = draft.safeParse({
      ...base(),
      caseMgmtReferral: 'COMPLEX_CARE',
      caseMgmtCriteria: 'NOT_MEETING',
      caseMgmtAction: 'FOR_ENROLLMENT',
      caseMgmtCalledAt: '2026-09-08T07:00:00Z',
      caseMgmtRepliedAt: '2026-09-08T09:00:00Z',
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.caseMgmtRepliedAt).toBeInstanceOf(Date)
    expect(draft.safeParse({ ...base(), caseMgmtReferral: 'SOCIAL_WORK' }).success).toBe(false)
    expect(draft.safeParse({ ...base(), caseMgmtCriteria: 'PARTIAL' }).success).toBe(false)
    expect(draft.safeParse({ ...base(), caseMgmtAction: 'DISCHARGED' }).success).toBe(false)
    // A reply before the call is a WARNING, not an error (warnings.test.ts).
    expect(
      draft.safeParse({
        ...base(),
        caseMgmtCalledAt: '2026-09-08T09:00:00Z',
        caseMgmtRepliedAt: '2026-09-08T07:00:00Z',
      }).success,
    ).toBe(true)
  })

  it('takes the two new dispositions on a draft and on a resolve (decision E)', () => {
    // Phase 13: each carries the times its own outcome needs (a death needs no decision time).
    const worked = {
      ...base(),
      triageAt: new Date('2026-09-08T06:20:00Z'),
      physicianAt: new Date('2026-09-08T07:00:00Z'),
      decisionAt: new Date('2026-09-08T09:00:00Z'),
      departedAt: new Date('2026-09-08T11:00:00Z'),
    }
    for (const disposition of ['DECEASED', 'REFERRED_UCC']) {
      expect(draft.safeParse({ ...base(), disposition }).success, disposition).toBe(true)
      expect(resolve.safeParse({ ...worked, disposition }).success, disposition).toBe(true)
    }
    // Neither is an admission, so neither asks for a ward.
    expect(issues(resolve.safeParse({ ...worked, disposition: 'DECEASED' }))).toEqual([])
    expect(draft.safeParse({ ...base(), disposition: 'LAMA' }).success).toBe(false)
  })

  it('accepts ISO strings for times and coerces them', () => {
    const r = draft.safeParse({ ...base(), registrationAt: '2026-09-08T06:00:00+03:00', triageAt: '2026-09-08T06:30:00Z' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.triageAt).toBeInstanceOf(Date)
  })
})

describe('resolve rules', () => {
  /**
   * Phase 13 (Ahmed, 12 September, decision C): every outcome needs some of the journey times
   * before it can be resolved, so the helper below carries the whole journey and each test
   * changes only the thing it is about. The required-by-outcome table itself is exercised in its
   * own block further down, both directions.
   */
  const JOURNEY = {
    triageAt: new Date('2026-09-08T06:20:00Z'),
    physicianAt: new Date('2026-09-08T07:00:00Z'),
    decisionAt: new Date('2026-09-08T09:00:00Z'),
    admOrderAt: new Date('2026-09-08T09:30:00Z'),
    bedAssignedAt: new Date('2026-09-08T10:30:00Z'),
    transferRequestedAt: new Date('2026-09-08T09:40:00Z'),
    transferAcceptedAt: new Date('2026-09-08T10:10:00Z'),
  }
  const resolved = () => ({ ...base(), ...JOURNEY, departedAt: new Date('2026-09-08T11:00:00Z') })

  it('requires a disposition', () => {
    expect(resolve.safeParse(resolved()).success).toBe(false)
  })

  it('ADMITTED requires a ward', () => {
    expect(issues(resolve.safeParse({ ...resolved(), disposition: 'ADMITTED' }))).toContain('wardId: Choose the ward.')
    expect(resolve.safeParse({ ...resolved(), disposition: 'ADMITTED', wardId: 'w-fmw' }).success).toBe(true)
  })

  /**
   * Phase 13: the receiving facility joins the tracking number. A transfer with no named facility
   * cannot be reported to the RCC and leaves the QCH column empty, so the two are asked together.
   */
  it('TRANSFERRED requires a referral tracking number and a receiving facility', () => {
    const bare = issues(resolve.safeParse({ ...resolved(), disposition: 'TRANSFERRED' }))
    expect(bare).toContain('referralTrackingNo: Enter the referral tracking number.')
    expect(bare).toContain('transferFacility: Enter the receiving facility.')
    expect(
      issues(resolve.safeParse({ ...resolved(), disposition: 'TRANSFERRED', referralTrackingNo: 'RCC-48213' })),
    ).toEqual(['transferFacility: Enter the receiving facility.'])
    expect(
      resolve.safeParse({
        ...resolved(),
        disposition: 'TRANSFERRED',
        referralTrackingNo: 'RCC-48213',
        transferFacility: 'Al Mouwasat',
      }).success,
    ).toBe(true)
  })

  it('a referred-out reason requires the tracking number on resolve, whatever the disposition', () => {
    const r = resolve.safeParse({ ...resolved(), reasons: [{ reasonId: 'r-refout' }], disposition: 'DISCHARGED_HOME' })
    expect(issues(r)).toContain('referralTrackingNo: Enter the referral tracking number.')
  })

  // Phase 7 C5: resolve used to be built from the unrefined object, so "Mark resolved" was a
  // one-tap route past every rule "Save changes" enforces. It now carries the same refinements.
  it('rejects an empty Other text, as the draft does', () => {
    const r = resolve.safeParse({ ...resolved(), reasons: [{ reasonId: 'r-other' }], disposition: 'DISCHARGED_HOME' })
    expect(issues(r)).toContain('reasons.0.otherText: Describe the other reason.')
    const ok = resolve.safeParse({
      ...resolved(),
      reasons: [{ reasonId: 'r-other', otherText: 'Family not answering' }],
      disposition: 'DISCHARGED_HOME',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects a reason that requires a department with no consult row, as the draft does', () => {
    const r = resolve.safeParse({ ...resolved(), reasons: [{ reasonId: 'r-consult' }], disposition: 'DISCHARGED_HOME' })
    expect(issues(r)).toContain('consults: Add the consulted team for this reason.')
    const ok = resolve.safeParse({
      ...resolved(),
      reasons: [{ reasonId: 'r-consult' }],
      consults: [{ departmentId: 'd-icu' }],
      disposition: 'DISCHARGED_HOME',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects a registration time in the future, as the draft does', () => {
    const r = resolve.safeParse({
      ...resolved(),
      registrationAt: new Date('2026-09-08T13:00:00Z'),
      disposition: 'DISCHARGED_HOME',
    })
    expect(issues(r)).toContain('registrationAt: Registration time cannot be in the future.')
  })

  /** Phase 8b, decision D: the two discharge answers are recorded at the resolve. */
  it('carries the discharge-communication answers, and refuses a bad pain pair as the draft does', () => {
    const ok = resolve.safeParse({
      ...resolved(),
      disposition: 'DISCHARGED_HOME',
      instructionsGiven: 'YES',
      familyEngagement: 'NOT_SURE',
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.instructionsGiven).toBe('YES')
      expect(ok.data.familyEngagement).toBe('NOT_SURE')
    }
    const bad = resolve.safeParse({ ...resolved(), disposition: 'DISCHARGED_HOME', pethidineDoseMg: 150 })
    expect(issues(bad)).toContain('pethidineDoseMg: Record the pethidine dose only when pethidine was prescribed.')
  })
})

/** Phase 8b, decision C: the weekly deck's action category on an update. */
describe('updateActionSchema', () => {
  it('takes the six deck categories', () => {
    for (const action of [
      'LEADERSHIP_ESCALATION',
      'BED_MANAGEMENT',
      'FAX_RCC',
      'PRO_SOCIAL_WORK',
      'FORCED_SAFETY_ADMISSION',
      'DAMA_MANAGEMENT',
    ]) {
      expect(updateActionSchema.safeParse(action).success, action).toBe(true)
    }
  })

  it('treats an untagged update as ordinary: null, undefined and a missing value all pass', () => {
    expect(updateActionSchema.safeParse(null).data).toBeNull()
    expect(updateActionSchema.safeParse(undefined).success).toBe(true)
  })

  it('refuses anything that is not one of the six', () => {
    expect(updateActionSchema.safeParse('ESCALATION').success).toBe(false)
    expect(updateActionSchema.safeParse('').success).toBe(false)
    expect(updateActionSchema.safeParse(3).success).toBe(false)
  })
})

describe('free text and identifiers', () => {
  it('updates need text and are capped', () => {
    expect(updateTextSchema.safeParse('   ').success).toBe(false)
    expect(updateTextSchema.safeParse('x'.repeat(1001)).success).toBe(false)
  })
  /**
   * Phase 10, the review of Slice 10A. The four boxes with a microphone read their caps from
   * here — as `maxLength`, and as the most a dictation may fill — so the numbers are pinned
   * (exporting them changed no rule) and each is exactly where its rule starts refusing.
   */
  it('exports the caps the free-text boxes read, each exactly where its rule starts refusing', () => {
    expect([DIAGNOSIS_MAX, OTHER_TEXT_MAX, NOTE_MAX, UPDATE_TEXT_MAX]).toEqual([80, 300, 1000, 1000])
    const fits = (max: number) => 'x'.repeat(max)
    const over = (max: number) => 'x'.repeat(max + 1)
    expect(issues(draft.safeParse({ ...base(), diagnosis: fits(DIAGNOSIS_MAX) }))).toEqual([])
    expect(issues(draft.safeParse({ ...base(), diagnosis: over(DIAGNOSIS_MAX) }))[0]).toMatch(/^diagnosis: /)
    const other = (text: string) => ({ ...base(), reasons: [{ reasonId: 'r-other', otherText: text }] })
    expect(issues(draft.safeParse(other(fits(OTHER_TEXT_MAX))))).toEqual([])
    expect(issues(draft.safeParse(other(over(OTHER_TEXT_MAX))))[0]).toMatch(/^reasons\.0\.otherText: /)
    expect(issues(draft.safeParse({ ...base(), resolutionNote: fits(NOTE_MAX) }))).toEqual([])
    expect(issues(draft.safeParse({ ...base(), resolutionNote: over(NOTE_MAX) }))[0]).toMatch(/^resolutionNote: /)
    expect(updateTextSchema.safeParse(fits(UPDATE_TEXT_MAX)).success).toBe(true)
    expect(updateTextSchema.safeParse(over(UPDATE_TEXT_MAX)).success).toBe(false)
  })
  it('void needs a reason', () => expect(voidSchema.safeParse({ version: 2, voidReason: 'no' }).success).toBe(false))
  it('warns on a 10-digit run and never blocks', () => {
    expect(phiWarnings('Update', 'called 0501234567 for pickup')).toHaveLength(1)
    expect(phiWarnings('Update', 'MRN 851557, bed 12')).toEqual([])
    expect(phiWarnings('Update', '12345678901')).toEqual([]) // 11 digits is not the 10-digit shape
    expect(phiWarnings('Update', null)).toEqual([])
  })
})

/**
 * Phase 13, Ahmed's decision C of 12 September 2026: which journey times an outcome cannot be
 * resolved without. The rule is one table in `src/lib/domain/journey.ts`, and this block is the
 * server half of it: every disposition, both directions, on the field's own path.
 *
 * Nothing here can reach "Open case": the draft schema is untouched, so a case still opens on an
 * MRN, a registration time and one reason (decision D). The last test in the block says so.
 */
describe('required by outcome (Phase 13)', () => {
  const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 8, h, m))
  const WHOLE_JOURNEY = {
    triageAt: T(6, 20),
    roomAt: T(6, 40),
    physicianAt: T(7),
    decisionAt: T(9),
    admOrderAt: T(9, 30),
    bedRequestedAt: T(9, 40),
    bedAssignedAt: T(10, 30),
    transferRequestedAt: T(9, 40),
    transferAcceptedAt: T(10, 10),
    transportArrivedAt: T(10, 50),
    departedAt: T(11),
    medAdminInformedAt: T(10),
  }
  /** Everything an outcome other than its times might also need. */
  const EXTRAS = { wardId: 'w-fmw', referralTrackingNo: 'RCC-48213', transferFacility: 'Al Mouwasat' }
  const full = (disposition: string) => ({ ...base(), ...WHOLE_JOURNEY, ...EXTRAS, disposition })

  const REQUIRED: Record<string, ReadonlyArray<[string, string]>> = {
    ADMITTED: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
      ['decisionAt', 'Disposition decided'],
      ['admOrderAt', 'Admission order written'],
      ['bedAssignedAt', 'Bed assigned'],
    ],
    DISCHARGED_HOME: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
      ['decisionAt', 'Disposition decided'],
    ],
    DISCHARGED_DAMA: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
      ['decisionAt', 'Disposition decided'],
    ],
    REFERRED_UCC: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
      ['decisionAt', 'Disposition decided'],
    ],
    TRANSFERRED: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
      ['decisionAt', 'Disposition decided'],
      ['transferRequestedAt', 'Transfer requested'],
      ['transferAcceptedAt', 'Accepted by facility'],
    ],
    LEFT_WITHOUT_BEING_SEEN: [],
    DECEASED: [
      ['triageAt', 'Triage'],
      ['physicianAt', 'First physician contact'],
    ],
    OTHER: [['triageAt', 'Triage']],
  }

  it.each(Object.keys(REQUIRED))('accepts a %s with the whole journey recorded', (disposition) => {
    expect(issues(resolve.safeParse(full(disposition)))).toEqual([])
  })

  it.each(Object.keys(REQUIRED))('refuses a %s that is missing one of its required times', (disposition) => {
    for (const [field, label] of REQUIRED[disposition]!) {
      const without = { ...full(disposition), [field]: null }
      expect(issues(resolve.safeParse(without)), `${disposition} without ${field}`).toContain(
        `${field}: Enter the ${label} time before resolving.`,
      )
    }
  })

  it.each(Object.keys(REQUIRED))('lets %s resolve without the optional times', (disposition) => {
    const bare = { ...full(disposition), roomAt: null, bedRequestedAt: null, transportArrivedAt: null, medAdminInformedAt: null }
    expect(issues(resolve.safeParse(bare))).toEqual([])
  })

  it('never asks a patient who left without being seen for a physician contact or a decision', () => {
    const lwbs = { ...full('LEFT_WITHOUT_BEING_SEEN'), triageAt: null, physicianAt: null, decisionAt: null }
    expect(issues(resolve.safeParse(lwbs))).toEqual([])
  })

  it('never asks a deceased patient for a disposition decision', () => {
    expect(issues(resolve.safeParse({ ...full('DECEASED'), decisionAt: null }))).toEqual([])
  })

  it('does not ask an admitted patient for the transfer times, or a transfer for the admission ones', () => {
    const admitted = { ...full('ADMITTED'), transferRequestedAt: null, transferAcceptedAt: null }
    expect(issues(resolve.safeParse(admitted))).toEqual([])
    const transferred = { ...full('TRANSFERRED'), admOrderAt: null, bedAssignedAt: null, wardId: null }
    expect(issues(resolve.safeParse(transferred))).toEqual([])
  })

  it('names every missing time at once, so one refusal is the whole list', () => {
    const nothing = { ...base(), ...EXTRAS, disposition: 'ADMITTED', departedAt: T(11) }
    expect(issues(resolve.safeParse(nothing)).sort()).toEqual(
      [
        'admOrderAt: Enter the Admission order written time before resolving.',
        'bedAssignedAt: Enter the Bed assigned time before resolving.',
        'decisionAt: Enter the Disposition decided time before resolving.',
        'physicianAt: Enter the First physician contact time before resolving.',
        'triageAt: Enter the Triage time before resolving.',
      ].sort(),
    )
  })

  /** Decision D: none of this reaches "Open case", where the rules are what they always were. */
  it('asks nothing of a saved draft, whatever disposition it carries', () => {
    for (const disposition of Object.keys(REQUIRED)) {
      expect(issues(draft.safeParse({ ...base(), disposition })), disposition).toEqual([])
    }
    expect(issues(draft.safeParse(base()))).toEqual([])
  })
})
