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

/**
 * How many cycles an alert's email may cost before the worker stops trying (Phase 12 item 6,
 * readiness audit C1). One attempt per cycle at the five-minute tick is roughly fifty minutes of
 * a broken mail server for an alert at the head of the queue — longer for one behind a backlog,
 * because the budget below can push it into a later cycle. Beyond this the row is left visibly
 * failed on Admin → Alerts rather than retried for ever.
 */
export const EMAIL_MAX_ATTEMPTS = 10

/**
 * The wall-clock the retry pass may spend before leaving the rest of the queue to the next cycle.
 *
 * This is the load-bearing bound, not the count cap. `heartbeat()` and the Kuma push both run
 * only after `runAlertCycle` resolves, and the worker's overlap guard drops every tick that
 * arrives while a cycle is running — so a slow pass is silent as well as long, and a pass that
 * outran the 900 s healthcheck window would report the worker unhealthy and page Kuma for a
 * locked mailbox, which is precisely the page this item exists to avoid. A minute is a fifth of
 * the five-minute tick and a fifteenth of the heartbeat window, whatever the backlog.
 */
export const RETRY_PASS_BUDGET_MS = 60_000

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
