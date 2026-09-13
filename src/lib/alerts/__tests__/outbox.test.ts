/**
 * Phase 16 (docs/specs/phase16-forgot-password.md, section 3): the outbox drain, against a fake
 * store and a fake mailer — the same seams `cycle.test.ts` uses, so the whole rule is asserted
 * with no Postgres and no SMTP server.
 *
 * The rule: a pending row is sent and stamped; a send that throws costs one attempt and a
 * `lastError` and leaves the row for the next poll; and with no mailer at all the message is
 * logged the way an alert is and the row is stamped sent anyway, so the queue on an instance with
 * no mail does not grow for ever.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Mailer, MailResult, OutgoingMessage } from '../email'
import {
  drainOutbox,
  OUTBOX_BATCH,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_MS,
  OUTBOX_REDACTED_TEXT,
  type OutboxMessage,
  type OutboxStore,
} from '../outbox'

const NOW = new Date('2026-09-13T10:00:00.000Z')
const TOKEN = 'a-token-nobody-else-should-see'

function message(id: string, attempts = 0): OutboxMessage {
  return {
    id,
    to: 'demo.lead@demo.invalid',
    subject: 'ER Navigator password reset',
    text: `Choose a new password here:\nhttps://nav.towardpcc.com/reset?token=${TOKEN}\n`,
    attempts,
  }
}

class FakeStore implements OutboxStore {
  sent: Array<{ id: string; at: Date }> = []
  failed: Array<{ id: string; error: string }> = []
  askedFor: number[] = []
  constructor(private readonly rows: OutboxMessage[] = []) {}

  async pending(limit: number): Promise<OutboxMessage[]> {
    this.askedFor.push(limit)
    return this.rows.slice(0, limit)
  }
  async markSent(id: string, at: Date): Promise<void> {
    this.sent.push({ id, at })
  }
  async markFailed(id: string, error: string): Promise<void> {
    this.failed.push({ id, error })
  }
}

function recordingLogger() {
  const lines: string[] = []
  const push =
    (level: string) =>
    (m: string, d?: unknown): void => {
      lines.push(`${level} ${m} ${d === undefined ? '' : JSON.stringify(d)}`)
    }
  return { logger: { info: push('info'), warn: push('warn'), error: push('error') }, lines }
}

const okMailer = (): Mailer & { sent: OutgoingMessage[] } => {
  const sent: OutgoingMessage[] = []
  return {
    sent,
    async send(m: OutgoingMessage): Promise<MailResult> {
      sent.push(m)
      return { accepted: m.to, rejected: [], response: '250 OK', messageId: 'id-1' }
    },
  }
}

describe('the poll', () => {
  it('is twenty seconds, and takes a bounded batch', () => {
    expect(OUTBOX_POLL_MS).toBe(20_000)
    expect(OUTBOX_BATCH).toBe(10)
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5)
  })

  /**
   * P16.43. `markSent` replaces the body as it stamps the row, so the twenty seconds above are
   * also the whole time a live link spends in the database. What it is replaced BY has to say so
   * to whoever reads the table later, and must not itself be mistaken for a message.
   */
  it('says what happened to a sent row, and carries no link of its own', () => {
    expect(OUTBOX_REDACTED_TEXT).toBe('[redacted on send]')
    expect(OUTBOX_REDACTED_TEXT).not.toContain('/reset')
    expect(OUTBOX_REDACTED_TEXT).not.toContain('http')
  })

  it('asks the store for at most one batch', async () => {
    const store = new FakeStore([])
    await drainOutbox({ store, mailer: okMailer(), logger: recordingLogger().logger, now: NOW })
    expect(store.askedFor).toEqual([OUTBOX_BATCH])
  })
})

describe('with a mailer', () => {
  it('sends a pending row and stamps it', async () => {
    const store = new FakeStore([message('out-1')])
    const mailer = okMailer()
    const summary = await drainOutbox({ store, mailer, logger: recordingLogger().logger, now: NOW })

    expect(summary).toEqual({ sent: 1, logged: 0, failed: 0 })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.to).toEqual(['demo.lead@demo.invalid'])
    expect(mailer.sent[0]!.subject).toBe('ER Navigator password reset')
    expect(store.sent).toEqual([{ id: 'out-1', at: NOW }])
    expect(store.failed).toEqual([])
  })

  it('costs one attempt and one lastError when the transport throws, and leaves the row pending', async () => {
    const store = new FakeStore([message('out-1')])
    const mailer: Mailer = { send: vi.fn().mockRejectedValue(new Error('550 mailbox unavailable')) }
    const summary = await drainOutbox({ store, mailer, logger: recordingLogger().logger, now: NOW })

    expect(summary).toEqual({ sent: 0, logged: 0, failed: 1 })
    expect(store.sent).toEqual([])
    expect(store.failed).toHaveLength(1)
    expect(store.failed[0]!.error).toContain('550 mailbox unavailable')
  })

  it('does not retry inside the poll: the next poll is twenty seconds away', async () => {
    const store = new FakeStore([message('out-1')])
    const send = vi.fn().mockRejectedValue(new Error('down'))
    await drainOutbox({ store, mailer: { send }, logger: recordingLogger().logger, now: NOW })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('carries on to the next row after one fails', async () => {
    const store = new FakeStore([message('out-1'), message('out-2')])
    let first = true
    const mailer: Mailer = {
      async send(m: OutgoingMessage): Promise<MailResult> {
        if (first) {
          first = false
          throw new Error('transient')
        }
        return { accepted: m.to, rejected: [], response: '250 OK', messageId: 'id' }
      },
    }
    const summary = await drainOutbox({ store, mailer, logger: recordingLogger().logger, now: NOW })
    expect(summary).toEqual({ sent: 1, logged: 0, failed: 1 })
    expect(store.sent.map((s) => s.id)).toEqual(['out-2'])
  })

  it('truncates a transport error rather than storing a stack trace', async () => {
    const store = new FakeStore([message('out-1')])
    const mailer: Mailer = { send: vi.fn().mockRejectedValue(new Error('x'.repeat(2000))) }
    await drainOutbox({ store, mailer, logger: recordingLogger().logger, now: NOW })
    expect(store.failed[0]!.error.length).toBeLessThanOrEqual(300)
  })

  it('says the last attempt was the last one, so a stuck row is visible', async () => {
    const store = new FakeStore([message('out-1', OUTBOX_MAX_ATTEMPTS - 1)])
    const mailer: Mailer = { send: vi.fn().mockRejectedValue(new Error('down')) }
    const { logger, lines } = recordingLogger()
    await drainOutbox({ store, mailer, logger, now: NOW })
    expect(lines.some((l) => l.startsWith('warn') && l.includes('giving up'))).toBe(true)
  })
})

describe('with no mailer (SMTP_HOST empty)', () => {
  it('logs the message the way an alert is logged and stamps the row sent', async () => {
    const store = new FakeStore([message('out-1')])
    const { logger, lines } = recordingLogger()
    const summary = await drainOutbox({ store, mailer: null, logger, now: NOW })

    expect(summary).toEqual({ sent: 0, logged: 1, failed: 0 })
    expect(store.sent).toEqual([{ id: 'out-1', at: NOW }])
    const logged = lines.find((l) => l.includes('[outbox]'))
    expect(logged).toContain('SMTP_HOST is empty')
    expect(logged).toContain('would have emailed')
    expect(logged).toContain('demo.lead@demo.invalid')
  })

  /**
   * The whole point of the outbox is that the raw token lives in the row's `text` for 30 minutes.
   * A log line that quoted the body would put it in the container log, and on the demo that is a
   * log anybody with host access reads.
   */
  it('never writes the message body, and so never writes the token', async () => {
    const store = new FakeStore([message('out-1')])
    const { logger, lines } = recordingLogger()
    await drainOutbox({ store, mailer: null, logger, now: NOW })
    for (const line of lines) expect(line).not.toContain(TOKEN)
  })
})

describe('an empty queue', () => {
  it('does nothing and says nothing', async () => {
    const store = new FakeStore([])
    const { logger, lines } = recordingLogger()
    const summary = await drainOutbox({ store, mailer: null, logger, now: NOW })
    expect(summary).toEqual({ sent: 0, logged: 0, failed: 0 })
    expect(lines).toEqual([])
  })
})
