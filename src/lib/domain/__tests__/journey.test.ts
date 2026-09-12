import { describe, expect, it } from 'vitest'
import {
  ADMISSION_JOURNEY_FIELDS,
  CORE_JOURNEY_FIELDS,
  hiddenRecordedJourneySteps,
  JOURNEY_LABELS,
  JOURNEY_STEPS,
  missingJourneyTimes,
  requiredJourneyFields,
  TRANSFER_JOURNEY_FIELDS,
  visibleJourneyFields,
  type JourneyField,
} from '../journey'
import { ADMISSION_STEPS, DISPOSITION_LABELS, MILESTONES, TRANSFER_STEPS } from '../taxonomy'

/**
 * Phase 13 (Ahmed, 12 September 2026, decisions B, C, E, F and G): the one "Patient journey"
 * block, what it shows and what it refuses to resolve without. Pure, so the server rule in
 * `validation.ts` and the editor's mirror cannot drift: both read this module.
 */

const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Array<keyof typeof DISPOSITION_LABELS>

const fieldsOf = (steps: ReadonlyArray<readonly [JourneyField, string]>): JourneyField[] =>
  steps.map(([field]) => field)

describe('JOURNEY_STEPS', () => {
  it('is the twelve steps in the order a patient flows through the ED', () => {
    expect(fieldsOf(JOURNEY_STEPS)).toEqual([
      'triageAt',
      'roomAt',
      'physicianAt',
      'decisionAt',
      'admOrderAt',
      'bedRequestedAt',
      'bedAssignedAt',
      'transferRequestedAt',
      'transferAcceptedAt',
      'transportArrivedAt',
      'departedAt',
      'medAdminInformedAt',
    ])
  })

  /**
   * The labels are the taxonomy's own strings, composed rather than copied: the hard rule is that
   * nothing in the taxonomy is renamed, and a second copy of a label is how one gets renamed by
   * halves.
   */
  it('takes every label from the taxonomy it already lives in', () => {
    const taxonomy = new Map<string, string>([...MILESTONES, ...ADMISSION_STEPS, ...TRANSFER_STEPS])
    for (const [field, label] of JOURNEY_STEPS) {
      if (field === 'medAdminInformedAt') continue
      expect(label, field).toBe(taxonomy.get(field))
    }
    expect(JOURNEY_LABELS.medAdminInformedAt).toBe('Medical admin on-call informed at')
    expect(JOURNEY_LABELS.departedAt).toBe('Left ED')
  })

  it('splits into the core, the admission steps and the transfer steps with nothing left over', () => {
    expect([...CORE_JOURNEY_FIELDS, ...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS].sort()).toEqual(
      fieldsOf(JOURNEY_STEPS).sort(),
    )
    expect(ADMISSION_JOURNEY_FIELDS).toEqual(['admOrderAt', 'bedRequestedAt', 'bedAssignedAt'])
    expect(TRANSFER_JOURNEY_FIELDS).toEqual(['transferRequestedAt', 'transferAcceptedAt', 'transportArrivedAt'])
  })
})

describe('visibleJourneyFields before a disposition is chosen', () => {
  const before = (stageCodes: string[], requiresReferralNo = false) =>
    visibleJourneyFields({ disposition: null, stageCodes, requiresReferralNo })

  it('shows the core steps and nothing else', () => {
    expect(before([])).toEqual([
      'triageAt',
      'roomAt',
      'physicianAt',
      'decisionAt',
      'departedAt',
      'medAdminInformedAt',
    ])
  })

  it('adds the admission steps for the admission stage', () => {
    expect(before(['adm'])).toContain('admOrderAt')
    expect(before(['adm'])).toContain('bedAssignedAt')
    expect(before(['adm'])).not.toContain('transferRequestedAt')
  })

  it('adds the transfer steps for the referral stage or a reason that needs a referral number', () => {
    expect(before(['ref'])).toContain('transferRequestedAt')
    expect(before([], true)).toContain('transferAcceptedAt')
    expect(before(['ref'])).not.toContain('admOrderAt')
  })

  it('keeps the flow order however the steps were added', () => {
    expect(before(['ref', 'adm'], true)).toEqual(fieldsOf(JOURNEY_STEPS))
  })
})

describe('visibleJourneyFields once a disposition is chosen', () => {
  const after = (disposition: keyof typeof DISPOSITION_LABELS, stageCodes: string[] = ['adm', 'ref']) =>
    visibleJourneyFields({ disposition, stageCodes, requiresReferralNo: true })

  it('shows the admission steps for an admitted patient and hides the transfer ones', () => {
    expect(after('ADMITTED')).toContain('admOrderAt')
    expect(after('ADMITTED')).not.toContain('transferRequestedAt')
  })

  it('shows the transfer steps for a transfer and hides the admission ones', () => {
    expect(after('TRANSFERRED')).toContain('transferAcceptedAt')
    expect(after('TRANSFERRED')).not.toContain('admOrderAt')
  })

  it('hides both chains for every discharge', () => {
    for (const d of ['DISCHARGED_HOME', 'DISCHARGED_DAMA', 'REFERRED_UCC', 'DECEASED'] as const) {
      expect(after(d), d).toEqual([
        'triageAt',
        'roomAt',
        'physicianAt',
        'decisionAt',
        'departedAt',
        'medAdminInformedAt',
      ])
    }
  })

  it('hides the physician and the decision for a patient who left without being seen', () => {
    expect(after('LEFT_WITHOUT_BEING_SEEN')).toEqual([
      'triageAt',
      'roomAt',
      'departedAt',
      'medAdminInformedAt',
    ])
  })

  /** OTHER is the catch-all, so it hides only what the stages had not implied in the first place. */
  it('hides nothing extra for OTHER', () => {
    expect(after('OTHER')).toEqual(fieldsOf(JOURNEY_STEPS))
    expect(visibleJourneyFields({ disposition: 'OTHER', stageCodes: [], requiresReferralNo: false })).toEqual(
      CORE_JOURNEY_FIELDS,
    )
  })

  it('always shows Left ED, whatever the outcome', () => {
    for (const d of DISPOSITIONS) expect(after(d), d).toContain('departedAt')
  })
})

describe('requiredJourneyFields', () => {
  it('requires nothing before a disposition is chosen', () => {
    expect(requiredJourneyFields(null)).toEqual([])
  })

  it('is the table Ahmed confirmed on 12 September', () => {
    expect(requiredJourneyFields('ADMITTED')).toEqual([
      'triageAt',
      'physicianAt',
      'decisionAt',
      'admOrderAt',
      'bedAssignedAt',
      'departedAt',
    ])
    for (const d of ['DISCHARGED_HOME', 'DISCHARGED_DAMA', 'REFERRED_UCC'] as const) {
      expect(requiredJourneyFields(d), d).toEqual(['triageAt', 'physicianAt', 'decisionAt', 'departedAt'])
    }
    expect(requiredJourneyFields('TRANSFERRED')).toEqual([
      'triageAt',
      'physicianAt',
      'decisionAt',
      'transferRequestedAt',
      'transferAcceptedAt',
      'departedAt',
    ])
    expect(requiredJourneyFields('LEFT_WITHOUT_BEING_SEEN')).toEqual(['departedAt'])
    expect(requiredJourneyFields('DECEASED')).toEqual(['triageAt', 'physicianAt', 'departedAt'])
    expect(requiredJourneyFields('OTHER')).toEqual(['triageAt', 'departedAt'])
  })

  it('never requires the room, the bed request, the transport or the med admin call', () => {
    for (const d of DISPOSITIONS) {
      for (const optional of ['roomAt', 'bedRequestedAt', 'transportArrivedAt', 'medAdminInformedAt'] as const) {
        expect(requiredJourneyFields(d), `${d} / ${optional}`).not.toContain(optional)
      }
    }
  })

  it('never requires a step the same outcome hides', () => {
    for (const d of DISPOSITIONS) {
      const visible = new Set(visibleJourneyFields({ disposition: d, stageCodes: [], requiresReferralNo: false }))
      for (const field of requiredJourneyFields(d)) expect(visible, `${d} / ${field}`).toContain(field)
    }
  })
})

describe('missingJourneyTimes', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 12, h)).toISOString()

  it('names the missing steps by their labels, in flow order', () => {
    expect(missingJourneyTimes('ADMITTED', { physicianAt: at(2), departedAt: at(9) })).toEqual([
      ['triageAt', 'Triage'],
      ['decisionAt', 'Disposition decided'],
      ['admOrderAt', 'Admission order written'],
      ['bedAssignedAt', 'Bed assigned'],
    ])
  })

  it('is empty when every required time is recorded, and reads an empty string as missing', () => {
    const full = {
      triageAt: at(1),
      physicianAt: at(2),
      decisionAt: at(3),
      departedAt: at(9),
    }
    expect(missingJourneyTimes('DISCHARGED_HOME', full)).toEqual([])
    expect(missingJourneyTimes('DISCHARGED_HOME', { ...full, triageAt: null })).toEqual([['triageAt', 'Triage']])
    expect(missingJourneyTimes('DISCHARGED_HOME', { ...full, departedAt: '' })).toEqual([['departedAt', 'Left ED']])
  })

  it('asks a patient who left without being seen for the departure alone', () => {
    expect(missingJourneyTimes('LEFT_WITHOUT_BEING_SEEN', {})).toEqual([['departedAt', 'Left ED']])
    expect(missingJourneyTimes('LEFT_WITHOUT_BEING_SEEN', { departedAt: at(4) })).toEqual([])
  })

  it('asks nothing of a case with no disposition', () => {
    expect(missingJourneyTimes(null, {})).toEqual([])
  })
})

describe('hiddenRecordedJourneySteps', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 12, h)).toISOString()

  /**
   * Decision G: a hide never drops a value. What the block stops showing it says out loud in one
   * line, so a transfer that ended in an admission still reports the two transfer times.
   */
  it('lists the recorded steps the outcome hides, in flow order', () => {
    expect(
      hiddenRecordedJourneySteps({
        disposition: 'ADMITTED',
        stageCodes: ['adm'],
        requiresReferralNo: false,
        values: { transferRequestedAt: at(3), transportArrivedAt: at(5), admOrderAt: at(6) },
      }),
    ).toEqual([
      ['transferRequestedAt', 'Transfer requested'],
      ['transportArrivedAt', 'RCC / transport arrived'],
    ])
  })

  it('is empty when every hidden step is empty', () => {
    expect(
      hiddenRecordedJourneySteps({
        disposition: 'DISCHARGED_HOME',
        stageCodes: [],
        requiresReferralNo: false,
        values: { triageAt: at(1) },
      }),
    ).toEqual([])
  })
})
