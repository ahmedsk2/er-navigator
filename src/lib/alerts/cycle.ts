/**
 * One pass of the alerts worker, with every side effect behind a port: the database is an
 * `AlertStore`, the mail server is a `Mailer`, the clock is a `Date` the caller passes in and
 * even the 30-second retry wait is injected. That is what lets the whole rule — fires 4h once,
 * emails from 6h, a restart does not re-fire, a case resolved between cycles fires nothing, a
 * send failure is retried once and logged — be asserted in the unit suite with no Postgres and
 * no SMTP server (Phase 6 spec, "Unit tests with an injected clock and a fake mailer").
 *
 * Two rules the spec is explicit about and this file implements literally:
 *  - idempotency is the database's job: `fire()` reports a unique-violation as `duplicate`, and
 *    a duplicate is counted and skipped, never retried and never emailed.
 *  - a send failure is logged, retried once after 30 s, and never thrown out of the cycle. The
 *    Alert row stays; only `emailSentAt` stays null.
 */
import { buildAlertEmail, type Mailer, type OutgoingMessage } from './email'
import {
  emailsAt,
  thresholdsDue,
  EMAIL_MAX_ATTEMPTS,
  RETRY_PASS_BUDGET_MS,
  type AlertCase,
} from './rules'
import { elapsedHours, type CaseClock } from '@/src/lib/domain/time'

export const EMAIL_RETRY_DELAY_MS = 30_000

export type FireOutcome = { fired: true; alertId: string } | { fired: false; reason: 'duplicate' }

/**
 * An active SUPERVISOR or ADMIN, as the database knows them. `email` is the address an Admin
 * typed on Admin → Users; it is null for most people, and someone without one is skipped with a
 * warning rather than guessed at (Phase 7 replaced the ALERT_EMAIL_MAP environment directory
 * with this column, so there is one place to look and it is the same place that lists the roles).
 */
export type Recipient = { username: string; displayName: string; email: string | null }

/**
 * An alert that is due an email and has not had one (Phase 12 item 6). It carries what the
 * template needs, so the retry pass never loads the case a second time.
 */
export type PendingEmail = CaseClock & {
  alertId: string
  caseId: string
  thresholdHours: number
  /** How many attempts this alert's email has already cost. */
  attempts: number
  mrn: string
  primaryReason: string | null
  departments: string[]
}

export type AlertStore = {
  /** Every OPEN case, with what the email needs to say. */
  openCases(): Promise<AlertCase[]>
  /** caseId -> the thresholds that already have an Alert row. */
  firedThresholds(caseIds: string[]): Promise<Map<string, number[]>>
  /** Alert + system-user CaseUpdate + `alert.fire` audit row, in one transaction. */
  fire(input: { caseId: string; thresholdHours: number; now: Date }): Promise<FireOutcome>
  markEmailSent(alertId: string, at: Date): Promise<void>
  /**
   * Alerts that are due an email, have not had one, whose case is still OPEN and whose attempts
   * are not exhausted, oldest first (Phase 12 item 6). Capped by the store.
   */
  pendingEmails(now: Date): Promise<PendingEmail[]>
  /** +1 attempt, stamp emailFailedAt, write the `alert.email.failed` audit row. One transaction. */
  markEmailFailed(alertId: string, at: Date): Promise<void>
  recipients(): Promise<Recipient[]>
}

export type Logger = {
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
}

export type CycleDeps = {
  store: AlertStore
  /** null when `SMTP_HOST` is empty: the message is logged at info level and not sent. */
  mailer: Mailer | null
  logger: Logger
  now: Date
  appUrl: string
  sleep?: (ms: number) => Promise<void>
  retryDelayMs?: number
  /** Read only by the retry pass's wall-clock budget, so a test can move time without waiting. */
  clock?: () => number
}

export type CycleSummary = {
  casesScanned: number
  alertsFired: number
  duplicates: number
  emailsSent: number
  emailsFailed: number
  emailsLogged: number
  /** Phase 12 item 6, the retry pass. All three appear in the worker's "cycle done" line. */
  emailsRetried: number
  emailsPending: number
  emailsDeferred: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Send, and on failure log it, wait and send once more. Returns the transport's answer, or null
 * when both attempts failed. Never throws: a mail server that is down must not stop the worker
 * recording that a patient has been waiting twelve hours.
 */
export async function sendWithOneRetry(
  mailer: Mailer,
  message: OutgoingMessage,
  logger: Logger,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
): Promise<{ response: string } | null> {
  try {
    return await mailer.send(message)
  } catch (first) {
    logger.warn(`[alerts] email failed, retrying in ${Math.round(retryDelayMs / 1000)}s`, {
      subject: message.subject,
      error: String(first),
    })
  }
  await sleep(retryDelayMs)
  try {
    return await mailer.send(message)
  } catch (second) {
    logger.error('[alerts] email failed twice, giving up for this alert', {
      subject: message.subject,
      error: String(second),
    })
    return null
  }
}

/**
 * The retry pass (Phase 12 item 6, readiness audit C1), run at the top of every cycle so a backlog
 * is worked through before new work is made.
 *
 * `retryDelayMs: 0` is deliberate and load-bearing. `sendWithOneRetry` sleeps between its two
 * attempts - 30 s in production, which the worker injects nothing to shorten - and this pass
 * replays a whole queue through it. Paying that here would cost half a minute a head before the
 * heartbeat is touched. The next cycle IS the retry, five minutes from now.
 *
 * When `mailer` is null - blank SMTP, which is the demo instance - the pass does not run at all:
 * nothing is attempted, nothing is counted failed, no audit row is written, and the queue is not
 * even queried.
 */
async function retryPass(
  deps: CycleDeps,
  summary: CycleSummary,
  recipientAddresses: () => Promise<string[]>,
): Promise<void> {
  const { store, mailer, logger, now, appUrl } = deps
  if (!mailer) return
  const sleep = deps.sleep ?? defaultSleep
  const clock = deps.clock ?? Date.now

  const pending = await store.pendingEmails(now)
  summary.emailsPending = pending.length
  if (pending.length === 0) return

  const deadline = clock() + RETRY_PASS_BUDGET_MS
  for (const alert of pending) {
    if (clock() >= deadline) {
      summary.emailsDeferred += 1
      continue
    }
    const to = await recipientAddresses()
    if (to.length === 0) {
      logger.warn('[alerts] no recipients with an address; the retry queue waits for later', {
        pending: pending.length,
      })
      break
    }

    const body = buildAlertEmail({
      mrn: alert.mrn,
      caseId: alert.caseId,
      thresholdHours: alert.thresholdHours,
      elapsedHours: elapsedHours(alert, now),
      primaryReason: alert.primaryReason,
      departments: alert.departments,
      appUrl,
    })
    const sent = await sendWithOneRetry(mailer, { to, ...body }, logger, sleep, 0)
    if (sent) {
      await store.markEmailSent(alert.alertId, now)
      summary.emailsRetried += 1
      logger.info('[alerts] retried and emailed', {
        subject: body.subject,
        attempts: alert.attempts + 1,
      })
      continue
    }

    await store.markEmailFailed(alert.alertId, now)
    summary.emailsFailed += 1
    if (alert.attempts + 1 >= EMAIL_MAX_ATTEMPTS) {
      logger.warn('[alerts] giving up on this email; the alert stays visibly failed on Admin', {
        alertId: alert.alertId,
        attempts: alert.attempts + 1,
      })
    }
  }

  if (summary.emailsDeferred > 0) {
    logger.warn('[alerts] the retry pass spent its budget; the rest waits for the next cycle', {
      deferred: summary.emailsDeferred,
    })
  }
}

export async function runAlertCycle(deps: CycleDeps): Promise<CycleSummary> {
  const { store, mailer, logger, now, appUrl } = deps
  const sleep = deps.sleep ?? defaultSleep
  const retryDelayMs = deps.retryDelayMs ?? EMAIL_RETRY_DELAY_MS

  const summary: CycleSummary = {
    casesScanned: 0,
    alertsFired: 0,
    duplicates: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsLogged: 0,
    emailsRetried: 0,
    emailsPending: 0,
    emailsDeferred: 0,
  }

  // Looked up at most once per cycle and never cached across cycles (spec), and only when an
  // email is actually due — a quiet night must not query the user table at all.
  let addresses: string[] | null = null
  const recipientAddresses = async (): Promise<string[]> => {
    if (addresses) return addresses
    const people = await store.recipients()
    const found: string[] = []
    for (const person of people) {
      if (person.email) found.push(person.email)
      else logger.warn('[alerts] no address on file for a supervisor or admin', person.username)
    }
    addresses = found
    return found
  }

  // Phase 12 item 6: clear the backlog before making new work, and before the early return below
  // - a quiet night with a stuck queue must still work through it.
  await retryPass(deps, summary, recipientAddresses)

  const cases = await store.openCases()
  summary.casesScanned = cases.length
  if (cases.length === 0) return summary

  const fired = await store.firedThresholds(cases.map((c) => c.id))

  for (const c of cases) {
    for (const thresholdHours of thresholdsDue(c, fired.get(c.id) ?? [], now)) {
      const outcome = await store.fire({ caseId: c.id, thresholdHours, now })
      if (!outcome.fired) {
        summary.duplicates += 1
        logger.info('[alerts] threshold already recorded by another worker or cycle', {
          mrn: c.mrn,
          thresholdHours,
        })
        continue
      }
      summary.alertsFired += 1
      logger.info('[alerts] fired', { mrn: c.mrn, thresholdHours, alertId: outcome.alertId })

      if (!emailsAt(thresholdHours)) continue

      const to = await recipientAddresses()
      if (to.length === 0) {
        logger.warn('[alerts] no recipients with an address; alert recorded but not emailed', {
          mrn: c.mrn,
          thresholdHours,
        })
        continue
      }

      const body = buildAlertEmail({
        mrn: c.mrn,
        caseId: c.id,
        thresholdHours,
        elapsedHours: elapsedHours(c, now),
        primaryReason: c.primaryReason,
        departments: c.departments,
        appUrl,
      })
      const message: OutgoingMessage = { to, ...body }

      if (!mailer) {
        summary.emailsLogged += 1
        logger.info(`[alerts] SMTP_HOST is empty; would have emailed ${to.join(', ')}`, {
          subject: message.subject,
          text: message.text,
        })
        continue
      }

      const sent = await sendWithOneRetry(mailer, message, logger, sleep, retryDelayMs)
      if (!sent) {
        // Phase 12 item 6: a durable trace, so the next cycle picks it up and Admin can see it.
        await store.markEmailFailed(outcome.alertId, now)
        summary.emailsFailed += 1
        continue
      }
      await store.markEmailSent(outcome.alertId, now)
      summary.emailsSent += 1
      logger.info('[alerts] emailed', { subject: message.subject, response: sent.response })
    }
  }

  return summary
}
