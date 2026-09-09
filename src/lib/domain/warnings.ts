/**
 * "Check these times" — out-of-order timestamp warnings, ported from the prototype's
 * `timeWarnings()` (docs/reference/ERNavigatorTracker.jsx) and locked plan section 4.
 *
 * Warnings never block a save. They are shown in the editor's "Check these times" panel, and
 * the same out-of-order pairs are excluded from every aggregate because `duration()` returns
 * null for them. The message shape is the prototype's: "<later label> is before <earlier label>".
 *
 * Pure: takes plain values, returns strings. The shape below is the editor's draft shape, not
 * the Prisma row; the server maps between them.
 */
import {
  ADMISSION_STEPS,
  CONSULT_STEPS,
  INVESTIGATION_LABELS,
  INVESTIGATION_STEPS,
  MILESTONES,
  TRANSFER_STEPS,
} from './taxonomy'

export type TimeValue = Date | string | null | undefined

export type ConsultTimes = { departmentName: string; consultedAt?: TimeValue; seenAt?: TimeValue; repliedAt?: TimeValue }
export type InvestigationTimes = {
  type: keyof typeof INVESTIGATION_STEPS
  orderedAt?: TimeValue
  collectedAt?: TimeValue
  receivedAt?: TimeValue
  doneAt?: TimeValue
  /**
   * Imaging only (Phase 8). It sits between the scan and the official report in
   * `INVESTIGATION_STEPS`, so the loop below produces "CT reported is before CT preliminary
   * report" when the two are the wrong way round — a warning, never a refused save, like every
   * other out-of-order pair here.
   */
  preliminaryAt?: TimeValue
  resultedAt?: TimeValue
}

export type CaseTimes = {
  registrationAt: TimeValue
  triageAt?: TimeValue
  roomAt?: TimeValue
  physicianAt?: TimeValue
  decisionAt?: TimeValue
  departedAt?: TimeValue
  admOrderAt?: TimeValue
  bedRequestedAt?: TimeValue
  bedAssignedAt?: TimeValue
  handoverAt?: TimeValue
  transferRequestedAt?: TimeValue
  transferAcceptedAt?: TimeValue
  transportArrivedAt?: TimeValue
  consults?: ReadonlyArray<ConsultTimes>
  investigations?: ReadonlyArray<InvestigationTimes>
}

function ms(v: TimeValue): number | null {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/** Push "<lb> is before <la>" when both exist and b < a. */
function check(out: string[], a: TimeValue, b: TimeValue, la: string, lb: string): void {
  const ta = ms(a)
  const tb = ms(b)
  if (ta != null && tb != null && tb < ta) out.push(`${lb} is before ${la}`)
}

export function timeWarnings(c: CaseTimes): string[] {
  const w: string[] = []
  const reg = c.registrationAt

  // Every journey milestone must be at or after registration; room at or after triage.
  for (const [key, label] of MILESTONES) check(w, reg, c[key], 'registration', label)
  check(w, c.triageAt, c.roomAt, 'triage', 'room')

  // Consults: consulted -> seen -> replied, per team.
  for (const x of c.consults ?? []) {
    const d = x.departmentName
    check(w, x.consultedAt, x.seenAt, `${d} consulted`, `${d} seen`)
    check(w, x.seenAt, x.repliedAt, `${d} seen`, `${d} replied`)
  }

  // Investigations: the step order of each type. Each recorded step is compared with the last
  // RECORDED step before it, not the literal previous entry: the optional preliminary report
  // sits between "scan done" and "reported", and comparing only neighbours would let a report
  // typed before the scan pass whenever the preliminary field is empty (Phase 8 review).
  for (const x of c.investigations ?? []) {
    const steps = INVESTIGATION_STEPS[x.type]
    const name = INVESTIGATION_LABELS[x.type]
    let previous: { key: (typeof steps)[number][0]; label: string } | null = null
    for (const [key, label] of steps) {
      if (ms(x[key]) == null) continue
      if (previous) check(w, x[previous.key], x[key], `${name} ${previous.label.toLowerCase()}`, `${name} ${label.toLowerCase()}`)
      previous = { key, label }
    }
  }

  // Admission chain and transfer chain, in order.
  for (let i = 1; i < ADMISSION_STEPS.length; i++) {
    const [prevKey, prevLabel] = ADMISSION_STEPS[i - 1]!
    const [key, label] = ADMISSION_STEPS[i]!
    check(w, c[prevKey], c[key], prevLabel.toLowerCase(), label.toLowerCase())
  }
  for (let i = 1; i < TRANSFER_STEPS.length; i++) {
    const [prevKey, prevLabel] = TRANSFER_STEPS[i - 1]!
    const [key, label] = TRANSFER_STEPS[i]!
    check(w, c[prevKey], c[key], prevLabel.toLowerCase(), label.toLowerCase())
  }

  return w
}

/** Re-exported so callers can build consult labels the same way the warnings do. */
export const CONSULT_STEP_LABELS = CONSULT_STEPS
