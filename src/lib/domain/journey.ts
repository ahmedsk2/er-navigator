/**
 * The patient journey: which times the case sheet shows, and which of them an outcome cannot be
 * resolved without (Phase 13, `docs/specs/phase13-case-sheet.md`; Ahmed, 12 September 2026).
 *
 * Pure, and the single source of both halves of the rule: `src/lib/domain/validation.ts` refuses
 * a resolve that is missing a required time, and `src/components/cases/CaseEditor.tsx` mirrors
 * exactly the same list under "Mark resolved". Two copies of a table like this drift within a
 * phase; one cannot.
 *
 * Every label is composed from the taxonomy pair it already lives in (`MILESTONES`,
 * `ADMISSION_STEPS`, `TRANSFER_STEPS`, `MED_ADMIN_STEP`) rather than written out again, because
 * the hard rule is that no taxonomy string is renamed and a second copy is how one gets renamed
 * by halves.
 */
import { ADMISSION_STEPS, DISPOSITION_LABELS, MED_ADMIN_STEP, MILESTONES, TRANSFER_STEPS } from './taxonomy'

export type Disposition = keyof typeof DISPOSITION_LABELS

/** The four milestones before the outcome steps: triage, room, physician, decision. */
const EARLY_STEPS = MILESTONES.filter(([field]) => field !== 'departedAt')
const DEPARTURE_STEP = MILESTONES.find(([field]) => field === 'departedAt')!

/**
 * The block's order, which is the order a patient moves through the ED: the early milestones,
 * then whichever outcome chain the case is on, then the departure, then the one call that can
 * happen at any point and is recorded last.
 */
export const JOURNEY_STEPS = [
  ...EARLY_STEPS,
  ...ADMISSION_STEPS,
  ...TRANSFER_STEPS,
  DEPARTURE_STEP,
  MED_ADMIN_STEP,
] as const

export type JourneyStep = (typeof JOURNEY_STEPS)[number]
export type JourneyField = JourneyStep[0]

export const JOURNEY_LABELS = Object.fromEntries(JOURNEY_STEPS) as Record<JourneyField, string>

export const ADMISSION_JOURNEY_FIELDS = ADMISSION_STEPS.map(([field]) => field) as JourneyField[]
export const TRANSFER_JOURNEY_FIELDS = TRANSFER_STEPS.map(([field]) => field) as JourneyField[]

/** The steps every case has, whatever happens to it. */
export const CORE_JOURNEY_FIELDS = JOURNEY_STEPS.map(([field]) => field).filter(
  (field) => !ADMISSION_JOURNEY_FIELDS.includes(field) && !TRANSFER_JOURNEY_FIELDS.includes(field),
) as JourneyField[]

/**
 * Per outcome: the steps it cannot have, and the times it cannot be resolved without.
 *
 * `hides: null` is OTHER, the catch-all: it hides nothing the selected stages had not already
 * left out, because there is no reading of "Other" that says which chain the patient was on.
 */
const OUTCOMES: Record<Disposition, { hides: JourneyField[] | null; requires: JourneyField[] }> = {
  ADMITTED: {
    hides: TRANSFER_JOURNEY_FIELDS,
    requires: ['triageAt', 'physicianAt', 'decisionAt', 'admOrderAt', 'bedAssignedAt', 'departedAt'],
  },
  DISCHARGED_HOME: {
    hides: [...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS],
    requires: ['triageAt', 'physicianAt', 'decisionAt', 'departedAt'],
  },
  DISCHARGED_DAMA: {
    hides: [...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS],
    requires: ['triageAt', 'physicianAt', 'decisionAt', 'departedAt'],
  },
  REFERRED_UCC: {
    hides: [...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS],
    requires: ['triageAt', 'physicianAt', 'decisionAt', 'departedAt'],
  },
  TRANSFERRED: {
    hides: ADMISSION_JOURNEY_FIELDS,
    requires: ['triageAt', 'physicianAt', 'decisionAt', 'transferRequestedAt', 'transferAcceptedAt', 'departedAt'],
  },
  // Nobody saw the patient, so there is no physician contact and no disposition decision to
  // record; the one time the ED knows is when they gave up waiting.
  LEFT_WITHOUT_BEING_SEEN: {
    hides: ['physicianAt', 'decisionAt', ...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS],
    requires: ['departedAt'],
  },
  // The decision is deliberately optional: a death in the department often has no disposition
  // decision in the sense the field means.
  DECEASED: {
    hides: [...ADMISSION_JOURNEY_FIELDS, ...TRANSFER_JOURNEY_FIELDS],
    requires: ['triageAt', 'physicianAt', 'departedAt'],
  },
  OTHER: { hides: null, requires: ['triageAt', 'departedAt'] },
}

/** The stage codes whose presence implies a chain of outcome steps before an outcome is chosen. */
const ADMISSION_STAGE = 'adm'
const TRANSFER_STAGE = 'ref'

export type JourneyContext = {
  /** The chosen final disposition, or null while the case is still open and undecided. */
  disposition: Disposition | null
  /** The codes of the delay stages selected on the case. */
  stageCodes: Iterable<string>
  /** Whether any selected reason is a `requiresReferralNo` one. */
  requiresReferralNo: boolean
}

/**
 * Which steps the block shows, in flow order.
 *
 * Before a disposition: the core steps, plus the admission chain when the admission stage is
 * selected and the transfer chain when the referral stage is, or when a selected reason needs a
 * referral number. After one: everything the outcome can have, whether or not a stage implied it,
 * because the outcome is the better evidence.
 */
export function visibleJourneyFields(context: JourneyContext): JourneyField[] {
  const rule = context.disposition ? OUTCOMES[context.disposition] : null
  const shown = new Set<JourneyField>(CORE_JOURNEY_FIELDS)
  if (rule && rule.hides) {
    const hidden = new Set(rule.hides)
    return JOURNEY_STEPS.map(([field]) => field).filter((field) => !hidden.has(field))
  }
  const stages = new Set(context.stageCodes)
  if (stages.has(ADMISSION_STAGE)) for (const field of ADMISSION_JOURNEY_FIELDS) shown.add(field)
  if (stages.has(TRANSFER_STAGE) || context.requiresReferralNo) {
    for (const field of TRANSFER_JOURNEY_FIELDS) shown.add(field)
  }
  return JOURNEY_STEPS.map(([field]) => field).filter((field) => shown.has(field))
}

/** The times the outcome cannot be resolved without, in flow order. Nothing before an outcome. */
export function requiredJourneyFields(disposition: Disposition | null): JourneyField[] {
  if (!disposition) return []
  const required = new Set(OUTCOMES[disposition].requires)
  return JOURNEY_STEPS.map(([field]) => field).filter((field) => required.has(field))
}

/** A recorded instant, however the caller holds it: an ISO string, a Date, or nothing. */
export type JourneyValues = Partial<Record<JourneyField, Date | string | null | undefined>>

/** The required steps that have no time, as `[field, label]` pairs in flow order. */
export function missingJourneyTimes(
  disposition: Disposition | null,
  values: JourneyValues,
): Array<readonly [JourneyField, string]> {
  return requiredJourneyFields(disposition)
    .filter((field) => !values[field])
    .map((field) => [field, JOURNEY_LABELS[field]] as const)
}

/**
 * The steps this case does not show that nevertheless hold a time (decision G). Nothing on the
 * screen may drop a recorded value, so the block lists these on one line instead.
 */
export function hiddenRecordedJourneySteps(
  input: JourneyContext & { values: JourneyValues },
): Array<readonly [JourneyField, string]> {
  const visible = new Set(visibleJourneyFields(input))
  return JOURNEY_STEPS.filter(([field]) => !visible.has(field) && Boolean(input.values[field])).map(
    ([field, label]) => [field, label] as const,
  )
}
