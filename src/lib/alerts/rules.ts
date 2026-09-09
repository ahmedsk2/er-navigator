/**
 * The firing rule, exactly as the locked plan section 6 and the Phase 6 spec state it:
 *
 *   for each OPEN case:
 *     h = elapsedHours(case, now)
 *     for t of [4, 6, 12, 24]:
 *       if h >= t and no Alert(caseId, t): fire
 *
 * Pure, so the whole rule can be tested with an injected clock and no database. Everything that
 * makes it durable — the unique index on (caseId, thresholdHours), the transaction, the email —
 * lives in `cycle.ts` and `store.ts`.
 */
import { THRESHOLDS_H } from '@/src/lib/domain/taxonomy'
import { elapsedHours, type CaseClock } from '@/src/lib/domain/time'

/** Thresholds at or above this one are emailed as well as recorded (spec: `if t >= 6`). */
export const EMAIL_THRESHOLD_H = 6

/** What the worker needs to know about a case to decide, plus what the email needs to say. */
export type AlertCase = CaseClock & {
  id: string
  mrn: string
  primaryReason: string | null
  departments: string[]
}

/**
 * The thresholds this case has crossed and has no Alert row for yet, in ascending order.
 *
 * A RESOLVED or VOIDED case fires nothing: `endAt()` freezes a resolved case's clock at its
 * departure time, but a case that was resolved between two cycles must not fire even for a
 * threshold its frozen stay exceeds — the point of an alert is that someone is still waiting.
 */
export function thresholdsDue(
  c: CaseClock,
  alreadyFired: Iterable<number>,
  now: Date,
): number[] {
  if (c.status !== 'OPEN') return []
  const hours = elapsedHours(c, now)
  if (hours == null) return []
  const fired = new Set(alreadyFired)
  return THRESHOLDS_H.filter((t) => hours >= t && !fired.has(t))
}

export function emailsAt(thresholdHours: number): boolean {
  return thresholdHours >= EMAIL_THRESHOLD_H
}

/** The text of the CaseUpdate the system user appends when a threshold fires. */
export function thresholdUpdateText(thresholdHours: number): string {
  return `Reached ${thresholdHours}h threshold`
}
