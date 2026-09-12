import { describe, expect, it } from 'vitest'
import {
  ADMISSION_JOURNEY_FIELDS,
  CORE_JOURNEY_FIELDS,
  hiddenRecordedJourneySteps,
  JOURNEY_LABELS,
  JOURNEY_STEPS,
  missingJourneyTimes,
  offeredDispositions,
  requiredJourneyFields,
  TRANSFER_JOURNEY_FIELDS,
  visibleJourneyFields,
  type JourneyField,
} from '../journey'
import { ADMISSION_STEPS, DISPOSITION_LABELS, MILESTONES, TRAJECTORIES, TRANSFER_STEPS } from '../taxonomy'

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

describe('visibleJourneyFields before a disposition or a trajectory is chosen', () => {
  const before = (stageCodes: string[], requiresReferralNo = false) =>
    visibleJourneyFields({ disposition: null, trajectory: null, stageCodes, requiresReferralNo })

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

/**
 * Phase 15 (docs/specs/phase15-trajectory.md; Ahmed, 12 September 2026, decisions A and B): the
 * trajectory is the nurse saying early where this patient is going, and while no outcome has been
 * chosen the block is about that pathway.
 */
describe('visibleJourneyFields once a trajectory is chosen', () => {
  const on = (
    trajectory: (typeof TRAJECTORIES)[number],
    stageCodes: string[] = [],
    requiresReferralNo = false,
  ) => visibleJourneyFields({ disposition: null, trajectory, stageCodes, requiresReferralNo })

  it('shows the core steps alone for a discharge', () => {
    expect(on('DISCHARGE')).toEqual(CORE_JOURNEY_FIELDS)
  })

  it('adds the admission chain for an admission and no transfer step', () => {
    expect(on('ADMISSION')).toEqual([
      'triageAt',
      'roomAt',
      'physicianAt',
      'decisionAt',
      'admOrderAt',
      'bedRequestedAt',
      'bedAssignedAt',
      'departedAt',
      'medAdminInformedAt',
    ])
  })

  it('adds the transfer chain for a transfer — the fax, the acceptance and the RCC', () => {
    expect(on('TRANSFER')).toEqual([
      'triageAt',
      'roomAt',
      'physicianAt',
      'decisionAt',
      'transferRequestedAt',
      'transferAcceptedAt',
      'transportArrivedAt',
      'departedAt',
      'medAdminInformedAt',
    ])
  })

  /**
   * Decision B: the Phase 13 stage implications stay only while the trajectory is not decided.
   * A nurse who says "this one is going home" has said more than the admission stage chip did.
   */
  it('governs over the stage implications', () => {
    expect(on('DISCHARGE', ['adm', 'ref'], true)).toEqual(CORE_JOURNEY_FIELDS)
    expect(on('ADMISSION', ['ref'], true)).not.toContain('transferRequestedAt')
    expect(on('TRANSFER', ['adm'])).not.toContain('admOrderAt')
  })

  /** Decision C: the outcome is the better evidence, and it arrives last. */
  it('gives way to the disposition once one is chosen', () => {
    expect(
      visibleJourneyFields({
        disposition: 'ADMITTED',
        trajectory: 'TRANSFER',
        stageCodes: [],
        requiresReferralNo: false,
      }),
    ).toContain('admOrderAt')
    expect(
      visibleJourneyFields({
        disposition: 'ADMITTED',
        trajectory: 'TRANSFER',
        stageCodes: [],
        requiresReferralNo: false,
      }),
    ).not.toContain('transferRequestedAt')
    expect(
      visibleJourneyFields({
        disposition: 'DISCHARGED_HOME',
        trajectory: 'ADMISSION',
        stageCodes: ['adm'],
        requiresReferralNo: false,
      }),
    ).toEqual(CORE_JOURNEY_FIELDS)
  })

  /**
   * The recorded deviation in item 3 of the spec: two of the eight outcomes have no trajectory,
   * and a patient who walked out has left the ED and nothing else. The departure is shown for
   * every trajectory and for none.
   */
  it('always shows Left ED, whatever the trajectory', () => {
    for (const t of TRAJECTORIES) expect(on(t), t).toContain('departedAt')
    expect(
      visibleJourneyFields({ disposition: null, trajectory: null, stageCodes: [], requiresReferralNo: false }),
    ).toContain('departedAt')
  })

  it('keeps the flow order however the steps were added', () => {
    for (const t of TRAJECTORIES) {
      const fields = on(t, ['adm', 'ref'], true)
      const order = fieldsOf(JOURNEY_STEPS)
      expect([...fields].sort((a, b) => order.indexOf(a) - order.indexOf(b)), t).toEqual(fields)
    }
  })

  /** Decision E: switching pathway hides a step, and a hide never drops what was recorded. */
  it('lists a time recorded under another pathway as also recorded', () => {
    expect(
      hiddenRecordedJourneySteps({
        disposition: null,
        trajectory: 'DISCHARGE',
        stageCodes: [],
        requiresReferralNo: false,
        values: { transferRequestedAt: '2026-09-12T09:10:00.000Z', triageAt: '2026-09-12T08:00:00.000Z' },
      }),
    ).toEqual([['transferRequestedAt', 'Transfer requested']])
  })
})

describe('visibleJourneyFields once a disposition is chosen', () => {
  const after = (disposition: keyof typeof DISPOSITION_LABELS, stageCodes: string[] = ['adm', 'ref']) =>
    visibleJourneyFields({ disposition, trajectory: null, stageCodes, requiresReferralNo: true })

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
    expect(
      visibleJourneyFields({
        disposition: 'OTHER',
        trajectory: null,
        stageCodes: [],
        requiresReferralNo: false,
      }),
    ).toEqual(CORE_JOURNEY_FIELDS)
  })

  /**
   * P15.40, spec row 1: once a disposition is set the outcome table governs, and the trajectory
   * is not consulted again. OTHER is the only outcome that can prove it. Every other row carries
   * a `hides` list, so `visibleJourneyFields` returns from the first rule and never reaches the
   * trajectory one; OTHER's `hides` is null, so an OTHER case falls through to it and is the one
   * case the `!context.disposition` guard on that rule actually decides. Without the guard an
   * OTHER case would take its steps from the plan the nurse made hours earlier instead of from
   * the outcome that overtook it — and the rest of this file would stay green.
   */
  it('reads the outcome and not the trajectory once OTHER is chosen', () => {
    for (const trajectory of ['ADMISSION', 'TRANSFER'] as const) {
      expect(
        visibleJourneyFields({ disposition: 'OTHER', trajectory, stageCodes: [], requiresReferralNo: false }),
        trajectory,
      ).toEqual(CORE_JOURNEY_FIELDS)
    }
    // The other half of the same rule: with an outcome set, the stage implications are what they
    // were, and a trajectory that contradicts them changes nothing.
    expect(
      visibleJourneyFields({
        disposition: 'OTHER',
        trajectory: 'DISCHARGE',
        stageCodes: ['adm'],
        requiresReferralNo: false,
      }),
    ).toEqual([
      'triageAt',
      'roomAt',
      'physicianAt',
      'decisionAt',
      'admOrderAt',
      'bedRequestedAt',
      'bedAssignedAt',
      'departedAt',
      'medAdminInformedAt',
    ])
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
      const visible = new Set(
        visibleJourneyFields({ disposition: d, trajectory: null, stageCodes: [], requiresReferralNo: false }),
      )
      for (const field of requiredJourneyFields(d)) expect(visible, `${d} / ${field}`).toContain(field)
    }
  })

  /**
   * Phase 15: what a case must record is decided by its outcome and by nothing else. No
   * trajectory can make a time mandatory, and none can excuse one.
   */
  it('is unmoved by the trajectory, and never hides a step the outcome requires', () => {
    for (const d of DISPOSITIONS) {
      for (const t of [null, ...TRAJECTORIES] as const) {
        const visible = new Set(
          visibleJourneyFields({ disposition: d, trajectory: t, stageCodes: [], requiresReferralNo: false }),
        )
        for (const field of requiredJourneyFields(d)) expect(visible, `${d} / ${t} / ${field}`).toContain(field)
      }
    }
  })
})

/**
 * Phase 15, decision D: the Final disposition list is narrowed by the trajectory, and every
 * outcome stays reachable behind "Show all outcomes".
 */
describe('offeredDispositions', () => {
  const ALL = Object.keys(DISPOSITION_LABELS) as Array<keyof typeof DISPOSITION_LABELS>

  it('offers every outcome while no trajectory is chosen', () => {
    expect(offeredDispositions({ trajectory: null, disposition: null })).toEqual(ALL)
  })

  it('is the three lists Ahmed saw, in the order the full list has them', () => {
    expect(offeredDispositions({ trajectory: 'DISCHARGE', disposition: null })).toEqual([
      'DISCHARGED_HOME',
      'DISCHARGED_DAMA',
      'LEFT_WITHOUT_BEING_SEEN',
      'OTHER',
      'DECEASED',
      'REFERRED_UCC',
    ])
    expect(offeredDispositions({ trajectory: 'ADMISSION', disposition: null })).toEqual([
      'ADMITTED',
      'OTHER',
      'DECEASED',
    ])
    expect(offeredDispositions({ trajectory: 'TRANSFER', disposition: null })).toEqual([
      'TRANSFERRED',
      'OTHER',
      'DECEASED',
    ])
  })

  it('offers Deceased and Other on every pathway, because either can end any of them', () => {
    for (const t of TRAJECTORIES) {
      expect(offeredDispositions({ trajectory: t, disposition: null }), t).toContain('DECEASED')
      expect(offeredDispositions({ trajectory: t, disposition: null }), t).toContain('OTHER')
    }
  })

  /** A saved outcome can never be dropped by a narrowing, or the select would render a blank. */
  it('always offers the outcome the case already carries', () => {
    expect(offeredDispositions({ trajectory: 'ADMISSION', disposition: 'TRANSFERRED' })).toEqual([
      'ADMITTED',
      'TRANSFERRED',
      'OTHER',
      'DECEASED',
    ])
    expect(offeredDispositions({ trajectory: 'ADMISSION', disposition: 'ADMITTED' })).toEqual([
      'ADMITTED',
      'OTHER',
      'DECEASED',
    ])
  })

  it('shows all eight when asked, whatever the trajectory says', () => {
    for (const t of TRAJECTORIES) {
      expect(offeredDispositions({ trajectory: t, disposition: null, showAll: true }), t).toEqual(ALL)
    }
  })

  it('never offers an outcome twice, and never one the app does not have', () => {
    for (const t of [null, ...TRAJECTORIES] as const) {
      for (const d of [null, ...ALL] as const) {
        const offered = offeredDispositions({ trajectory: t, disposition: d })
        expect(new Set(offered).size, `${t} / ${d}`).toBe(offered.length)
        for (const value of offered) expect(ALL, `${t} / ${d}`).toContain(value)
      }
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
        trajectory: null,
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
        trajectory: null,
        stageCodes: [],
        requiresReferralNo: false,
        values: { triageAt: at(1) },
      }),
    ).toEqual([])
  })
})
