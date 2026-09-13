/**
 * The outbox drain (Phase 16, docs/specs/phase16-forgot-password.md, section 3).
 *
 * The app cannot send mail: a server action that opens a socket to a mail server blocks a nurse's
 * form on that mail server, and a hospital SMTP host that is slow would turn "ask for a link"
 * into a thirty-second spinner. So the app appends an `Outbox` row and this runs in the alerts
 * worker, which already owns the transport, the log-only mode and the retry discipline.
 *
 * WHAT IT MUST NOT DO. It must not touch the heartbeat, must not call the push monitor, and must
 * not be able to fail an alert cycle: a reset email is not a patient who has been waiting twelve
 * hours, and it must never be the reason the container reports unhealthy. The worker runs it on
 * its own twenty-second timer with its own overlap guard, and catches everything.
 *
 * There is no in-poll retry, deliberately, and no `sendWithOneRetry`: the next poll IS the retry,
 * twenty seconds from now, and a poll that slept would hold the timer open for nothing.
 */
import type { Mailer } from './email'
import type { Logger } from './cycle'

/** Ahmed asked for "a link is on its way"; twenty seconds is what makes that sentence true. */
export const OUTBOX_POLL_MS = 20_000

/** One poll never carries an unbounded queue. Ten is far more than this application will make. */
export const OUTBOX_BATCH = 10

/**
 * After five failures the row stops being selected and stays visibly unsent, with its `lastError`
 * on it. A permanently bad address must not be retried three times a minute for ever.
 */
export const OUTBOX_MAX_ATTEMPTS = 5

/** How much of a transport error is worth keeping: the message, never a stack trace. */
export const OUTBOX_ERROR_MAX = 300

/**
 * What a sent row's `text` becomes (P16.43, the hardening taken from the third finding of the
 * security review on 13 September).
 *
 * A reset body holds a live link for thirty minutes and the row has no further use for it once
 * the message has gone. Replacing it on send bounds the time a token spends in the database to a
 * single 20-second poll, and keeps it out of every backup taken after that — the app role can
 * read `Outbox`, and unlike `Session`, which stores only a digest, an unsent row here holds the
 * secret itself.
 *
 * FAILED rows keep their text, and must: the next poll is the retry, and there is nothing to
 * retry with once the body is gone. A row that runs out of attempts therefore stays visibly
 * unsent WITH its link, which is the deliberate trade — five failures in a row means somebody has
 * to look at it, and the token in it has almost certainly expired by then anyway.
 */
export const OUTBOX_REDACTED_TEXT = '[redacted on send]'

/** A row waiting to be sent. Deliberately not the Prisma model. */
export type OutboxMessage = {
  id: string
  to: string
  subject: string
  text: string
  /** How many attempts this row has already cost. */
  attempts: number
}

export type OutboxStore = {
  /** `sentAt IS NULL AND attempts < OUTBOX_MAX_ATTEMPTS`, oldest first, at most `limit`. */
  pending(limit: number): Promise<OutboxMessage[]>
  /**
   * Stamps `sentAt` AND replaces `text` with `OUTBOX_REDACTED_TEXT` (P16.43). The two are one
   * write on purpose: a row that is sent is a row whose body is spent, and the body of a reset
   * message is a live link.
   */
  markSent(id: string, at: Date): Promise<void>
  /**
   * +1 attempt and `lastError`. No timestamp: `createdAt` plus the count is the record. The text
   * is left alone, because the next poll is the retry and it needs something to send.
   */
  markFailed(id: string, error: string): Promise<void>
}

export type OutboxSummary = {
  sent: number
  /** Logged instead of sent, because `SMTP_HOST` is empty. Stamped sent all the same. */
  logged: number
  failed: number
}

export type DrainDeps = {
  store: OutboxStore
  /** null when `SMTP_HOST` is empty: the message is logged at info level and not sent. */
  mailer: Mailer | null
  logger: Logger
  now: Date
  limit?: number
}

export async function drainOutbox(deps: DrainDeps): Promise<OutboxSummary> {
  const { store, mailer, logger, now } = deps
  const summary: OutboxSummary = { sent: 0, logged: 0, failed: 0 }

  const rows = await store.pending(deps.limit ?? OUTBOX_BATCH)
  for (const row of rows) {
    // Log-only, exactly as the alert cycle does it with a null mailer. The row is stamped sent so
    // the queue on an instance that has no mail does not grow for ever — which is the demo, and
    // is what makes the flow demonstrable there with nothing leaving the host.
    //
    // The body is never logged: it holds a live token for thirty minutes.
    if (!mailer) {
      await store.markSent(row.id, now)
      summary.logged += 1
      logger.info(`[outbox] SMTP_HOST is empty; would have emailed ${row.to}`, {
        id: row.id,
        subject: row.subject,
      })
      continue
    }

    try {
      const result = await mailer.send({ to: [row.to], subject: row.subject, text: row.text, html: '' })
      await store.markSent(row.id, now)
      summary.sent += 1
      logger.info('[outbox] emailed', { id: row.id, subject: row.subject, response: result.response })
    } catch (error) {
      const attempts = row.attempts + 1
      await store.markFailed(row.id, String(error).slice(0, OUTBOX_ERROR_MAX))
      summary.failed += 1
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        logger.warn('[outbox] giving up on this message; the row stays visibly unsent', {
          id: row.id,
          attempts,
        })
      } else {
        logger.warn('[outbox] send failed; the next poll will try again', { id: row.id, attempts })
      }
    }
  }

  return summary
}
