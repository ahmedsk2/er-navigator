/**
 * The worker's rule, end to end, with an injected clock, a fake database and a fake mailer — the
 * five behaviours the Phase 6 spec names, plus the two the spec's idempotency clause implies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailResult, Mailer, OutgoingMessage } from '../email'
import {
  EMAIL_RETRY_DELAY_MS,
  runAlertCycle,
  type AlertStore,
  type FireOutcome,
  type Logger,
  type PendingEmail,
  type Recipient,
} from '../cycle'
import { EMAIL_MAX_ATTEMPTS, RETRY_PASS_BUDGET_MS, type AlertCase } from '../rules'

const HOUR = 36e5
const T0 = new Date('2026-09-09T00:00:00.000Z')
const at = (hours: number): Date => new Date(T0.getTime() + hours * HOUR)

type StoredAlert = {
  id: string
  caseId: string
  thresholdHours: number
  emailSentAt: Date | null
  emailAttempts: number
  emailFailedAt: Date | null
}

/**
 * A store that behaves like the real one: the unique index on (caseId, thresholdHours) is a Set,
 * and `fire` reports a second insert as a duplicate instead of throwing.
 */
class FakeStore implements AlertStore {
  cases: AlertCase[] = []
  alerts: StoredAlert[] = []
  people: Recipient[] = [{ username: 'sami', displayName: 'Sami Supervisor', email: 'sami@example.org' }]
  updates: Array<{ caseId: string; thresholdHours: number }> = []
  recipientLookups = 0
  private next = 1

  async openCases(): Promise<AlertCase[]> {
    return this.cases.filter((c) => c.status === 'OPEN')
  }

  async firedThresholds(caseIds: string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>()
    for (const a of this.alerts) {
      if (!caseIds.includes(a.caseId)) continue
      map.set(a.caseId, [...(map.get(a.caseId) ?? []), a.thresholdHours])
    }
    return map
  }

  async fire(input: { caseId: string; thresholdHours: number; now: Date }): Promise<FireOutcome> {
    const clash = this.alerts.some(
      (a) => a.caseId === input.caseId && a.thresholdHours === input.thresholdHours,
    )
    if (clash) return { fired: false, reason: 'duplicate' }
    const id = `alert${this.next++}`
    this.alerts.push({
      id,
      caseId: input.caseId,
      thresholdHours: input.thresholdHours,
      emailSentAt: null,
      emailAttempts: 0,
      emailFailedAt: null,
    })
    this.updates.push({ caseId: input.caseId, thresholdHours: input.thresholdHours })
    return { fired: true, alertId: id }
  }

  async markEmailSent(alertId: string, sentAt: Date): Promise<void> {
    const row = this.alerts.find((a) => a.id === alertId)
    if (row) row.emailSentAt = sentAt
  }

  /**
   * Phase 12 item 6. The real store's query lives in `store.ts` and is asserted against Postgres
   * in `tests/db/alerts.test.ts`; here the queue is handed to the cycle directly, so the cycle's
   * half of the contract is the only thing under test.
   */
  pending: PendingEmail[] = []
  pendingLookups = 0
  failed: Array<{ alertId: string; at: Date }> = []

  async pendingEmails(): Promise<PendingEmail[]> {
    this.pendingLookups += 1
    return this.pending
  }

  async markEmailFailed(alertId: string, at: Date): Promise<void> {
    this.failed.push({ alertId, at })
    const row = this.alerts.find((a) => a.id === alertId)
    if (row) {
      row.emailAttempts += 1
      row.emailFailedAt = at
    }
  }

  async recipients(): Promise<Recipient[]> {
    this.recipientLookups += 1
    return this.people
  }
}

/** A queue entry shaped the way the store returns one. */
function pendingOf(alertId: string, caseId: string, thresholdHours = 6, attempts = 0): PendingEmail {
  const c = caseAt(caseId, thresholdHours)
  return {
    alertId,
    caseId,
    thresholdHours,
    attempts,
    mrn: c.mrn,
    status: c.status,
    registrationAt: c.registrationAt,
    departedAt: c.departedAt,
    resolvedAt: c.resolvedAt,
    primaryReason: c.primaryReason,
    departments: c.departments,
  }
}

class FakeMailer implements Mailer {
  sent: OutgoingMessage[] = []
  failuresLeft = 0

  async send(message: OutgoingMessage): Promise<MailResult> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1
      throw new Error('connection refused')
    }
    this.sent.push(message)
    return { accepted: message.to, rejected: [], response: '250 2.0.0 Ok', messageId: '<id@test>' }
  }
}

function fakeLogger(): Logger & { infos: string[]; warns: string[]; errors: string[] } {
  const infos: string[] = []
  const warns: string[] = []
  const errors: string[] = []
  return {
    infos,
    warns,
    errors,
    info: (m) => void infos.push(m),
    warn: (m) => void warns.push(m),
    error: (m) => void errors.push(m),
  }
}

function caseAt(id: string, registeredHoursBeforeT0: number): AlertCase {
  return {
    id,
    mrn: `85155${id.slice(-1)}`,
    status: 'OPEN',
    registrationAt: new Date(T0.getTime() - registeredHoursBeforeT0 * HOUR),
    departedAt: null,
    resolvedAt: null,
    primaryReason: 'No bed available on accepting ward',
    departments: ['ICU'],
  }
}

let store: FakeStore
let mailer: FakeMailer
let logger: ReturnType<typeof fakeLogger>

const sleep = vi.fn(async (ms: number) => {
  void ms
})

function cycle(now: Date, over: Partial<Parameters<typeof runAlertCycle>[0]> = {}) {
  return runAlertCycle({
    store,
    mailer,
    logger,
    now,
    appUrl: 'https://nav.towardpcc.com',
    sleep,
    retryDelayMs: 30_000,
    ...over,
  })
}

beforeEach(() => {
  store = new FakeStore()
  mailer = new FakeMailer()
  logger = fakeLogger()
  sleep.mockClear()
})

describe('runAlertCycle', () => {
  it('fires the 4 h threshold once and does not fire it again on the next cycle', async () => {
    store.cases = [caseAt('c1', 4)]

    const first = await cycle(T0)
    expect(first.alertsFired).toBe(1)
    expect(store.alerts).toEqual([
      expect.objectContaining({ caseId: 'c1', thresholdHours: 4, emailSentAt: null }),
    ])
    expect(store.updates).toEqual([{ caseId: 'c1', thresholdHours: 4 }])
    // Four hours does not email (spec: only t >= 6).
    expect(mailer.sent).toHaveLength(0)

    const second = await cycle(at(0.1))
    expect(second.alertsFired).toBe(0)
    expect(store.alerts).toHaveLength(1)
    expect(store.updates).toHaveLength(1)
  })

  it('emails the supervisors at 6 h and stamps emailSentAt', async () => {
    store.cases = [caseAt('c1', 6)]

    const summary = await cycle(T0)
    expect(summary.alertsFired).toBe(2) // 4 h and 6 h both crossed
    expect(summary.emailsSent).toBe(1)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.to).toEqual(['sami@example.org'])
    expect(mailer.sent[0]!.subject).toBe('ER Navigator: MRN 851551 past 6h')
    expect(store.alerts.find((a) => a.thresholdHours === 6)!.emailSentAt).toEqual(T0)
    expect(store.alerts.find((a) => a.thresholdHours === 4)!.emailSentAt).toBeNull()
  })

  it('looks the recipients up once per cycle and again on the next one', async () => {
    store.cases = [caseAt('c1', 6), caseAt('c2', 13)]
    await cycle(T0)
    expect(store.recipientLookups).toBe(1)
    store.cases.push(caseAt('c3', 24))
    await cycle(at(0.1))
    expect(store.recipientLookups).toBe(2)
  })

  it('a restart does not re-fire: a fresh cycle over the same rows writes nothing', async () => {
    store.cases = [caseAt('c1', 25)]
    const first = await cycle(T0)
    expect(first.alertsFired).toBe(4)
    expect(first.emailsSent).toBe(3)

    // A restart is exactly this: new objects, same database.
    mailer = new FakeMailer()
    logger = fakeLogger()
    const afterRestart = await cycle(at(0.2))
    expect(afterRestart.alertsFired).toBe(0)
    expect(afterRestart.emailsSent).toBe(0)
    expect(store.alerts).toHaveLength(4)
  })

  it('a case resolved between two cycles fires nothing new', async () => {
    const c = caseAt('c1', 5)
    store.cases = [c]
    const first = await cycle(T0)
    expect(first.alertsFired).toBe(1) // 4 h

    // The nurse resolves it before it reaches six hours.
    c.status = 'RESOLVED'
    c.departedAt = at(0.5)
    c.resolvedAt = at(0.5)

    const second = await cycle(at(2)) // its frozen stay is 5.5 h, its live stay would be 7 h
    expect(second.casesScanned).toBe(0)
    expect(second.alertsFired).toBe(0)
    expect(store.alerts).toHaveLength(1)
  })

  it('retries a failed send once and logs it, keeping the Alert row', async () => {
    store.cases = [caseAt('c1', 6)]
    mailer.failuresLeft = 1

    const summary = await cycle(T0)
    expect(summary.emailsSent).toBe(1)
    expect(sleep).toHaveBeenCalledWith(30_000)
    expect(logger.warns.some((m) => m.includes('email failed, retrying'))).toBe(true)
    expect(mailer.sent).toHaveLength(1)
  })

  it('gives up after the second failure without throwing, and leaves emailSentAt null', async () => {
    store.cases = [caseAt('c1', 6)]
    mailer.failuresLeft = 2

    const summary = await cycle(T0)
    expect(summary.alertsFired).toBe(2)
    expect(summary.emailsFailed).toBe(1)
    expect(summary.emailsSent).toBe(0)
    expect(logger.errors.some((m) => m.includes('email failed twice'))).toBe(true)
    expect(store.alerts.find((a) => a.thresholdHours === 6)!.emailSentAt).toBeNull()
  })

  it('logs the message instead of sending it when there is no mailer (SMTP_HOST empty)', async () => {
    store.cases = [caseAt('c1', 6)]
    const summary = await cycle(T0, { mailer: null })
    expect(summary.emailsLogged).toBe(1)
    expect(summary.emailsSent).toBe(0)
    expect(store.alerts.find((a) => a.thresholdHours === 6)!.emailSentAt).toBeNull()
    expect(logger.infos.some((m) => m.includes('SMTP_HOST is empty'))).toBe(true)
  })

  it('records the alert and warns when a supervisor has no address on file', async () => {
    store.cases = [caseAt('c1', 6)]
    store.people = [{ username: 'unlisted', displayName: 'No Address', email: null }]

    const summary = await cycle(T0)
    expect(summary.alertsFired).toBe(2)
    expect(summary.emailsSent).toBe(0)
    expect(mailer.sent).toHaveLength(0)
    expect(logger.warns.some((m) => m.includes('no address on file'))).toBe(true)
    expect(logger.warns.some((m) => m.includes('not emailed'))).toBe(true)
  })

  it('counts a unique-violation as a duplicate and does not email for it', async () => {
    store.cases = [caseAt('c1', 6)]
    // Another worker got there first between the read and the write.
    store.alerts.push({
      id: 'other',
      caseId: 'c1',
      thresholdHours: 6,
      emailSentAt: null,
      emailAttempts: 0,
      emailFailedAt: null,
    })
    const seen = await store.firedThresholds(['c1'])
    expect(seen.get('c1')).toEqual([6])

    // Simulate the race: the cycle believes nothing has fired.
    store.firedThresholds = async () => new Map()

    const summary = await cycle(T0)
    expect(summary.alertsFired).toBe(1) // only the 4 h one
    expect(summary.duplicates).toBe(1)
    expect(summary.emailsSent).toBe(0)
    expect(mailer.sent).toHaveLength(0)
  })

  it('does nothing at all, and asks nothing of the database, when no case is open', async () => {
    store.cases = []
    const summary = await cycle(T0)
    expect(summary).toMatchObject({ casesScanned: 0, alertsFired: 0, emailsSent: 0 })
    expect(store.recipientLookups).toBe(0)
  })
})

/**
 * Phase 12 item 6 (readiness audit C1). Today `sendWithOneRetry` returns null after two failures,
 * `emailsFailed` is incremented, the loop continues — and the Alert row is already committed, so
 * `firedThresholds()` makes every later cycle a no-op for it, for ever. A wrong SMTP password
 * stops every 6 h+ escalation while the heartbeat and the Kuma monitor both stay green.
 */
describe('an email that fails is not lost', () => {
  it('marks the alert failed instead of only counting it', async () => {
    store.cases = [caseAt('c1', 6)]
    mailer.failuresLeft = 2

    const summary = await cycle(T0)
    expect(summary.emailsFailed).toBe(1)
    expect(store.failed).toHaveLength(1)
    const alert = store.alerts.find((a) => a.thresholdHours === 6)!
    expect(store.failed[0]).toEqual({ alertId: alert.id, at: T0 })
    expect(alert.emailAttempts).toBe(1)
    expect(alert.emailSentAt).toBeNull()
  })

  it('the next cycle retries it, and a mailer that works now sends it', async () => {
    store.alerts = [
      { id: 'alertX', caseId: 'c1', thresholdHours: 6, emailSentAt: null, emailAttempts: 1, emailFailedAt: T0 },
    ]
    store.pending = [pendingOf('alertX', 'c1')]

    const summary = await cycle(at(0.1))
    expect(summary.emailsPending).toBe(1)
    expect(summary.emailsRetried).toBe(1)
    expect(summary.emailsFailed).toBe(0)
    expect(store.failed).toHaveLength(0)
    expect(store.alerts[0]!.emailSentAt).toEqual(at(0.1))
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.subject).toContain('past 6h')
  })

  it('counts a retry that fails again, and leaves it for the cycle after', async () => {
    store.alerts = [
      { id: 'alertX', caseId: 'c1', thresholdHours: 6, emailSentAt: null, emailAttempts: 1, emailFailedAt: T0 },
    ]
    store.pending = [pendingOf('alertX', 'c1', 6, 1)]
    mailer.failuresLeft = 2

    const summary = await cycle(at(0.1))
    expect(summary.emailsRetried).toBe(0)
    expect(summary.emailsFailed).toBe(1)
    expect(store.failed).toEqual([{ alertId: 'alertX', at: at(0.1) }])
    expect(store.alerts[0]!.emailAttempts).toBe(2)
  })

  it('pays no 30 s sleep in the retry pass: the next cycle is the retry', async () => {
    store.pending = [pendingOf('a1', 'c1'), pendingOf('a2', 'c2'), pendingOf('a3', 'c3')]
    mailer.failuresLeft = 99

    await cycle(T0)
    const sleeps = sleep.mock.calls.map((c) => c[0])
    // The helper sleeps between its two attempts unconditionally, and production injects the real
    // 30 s. Three heads at 30 s each, with the SMTP timeouts on top, is how one cycle outruns the
    // 900 s heartbeat window while the worker's overlap guard drops every intervening tick.
    expect(sleeps).not.toContain(EMAIL_RETRY_DELAY_MS)
    expect(store.failed).toHaveLength(3)
  })

  it('stops at the wall-clock budget and leaves the rest for the next cycle', async () => {
    store.pending = Array.from({ length: 20 }, (_, i) => pendingOf(`a${i}`, `c${i}`))
    mailer.failuresLeft = 99

    // A clock that jumps past the budget once two alerts have been attempted: read 1 sets the
    // deadline, then one read per loop head.
    let reads = 0
    const clock = (): number => {
      reads += 1
      return reads > 3 ? RETRY_PASS_BUDGET_MS + 1 : 0
    }

    const summary = await cycle(T0, { clock })
    expect(summary.emailsFailed).toBe(2)
    expect(store.failed).toHaveLength(2)
    expect(summary.emailsDeferred).toBe(18)
    expect(summary.emailsPending).toBe(20)
    expect(summary.emailsFailed + summary.emailsRetried + summary.emailsDeferred).toBe(20)
  })

  it('blank SMTP attempts nothing, fails nothing and queries no queue', async () => {
    store.cases = [caseAt('c1', 6)]
    store.pending = [pendingOf('a1', 'c9'), pendingOf('a2', 'c8')]

    const summary = await cycle(T0, { mailer: null })
    expect(store.pendingLookups).toBe(0)
    expect(store.failed).toHaveLength(0)
    expect(summary.emailsFailed).toBe(0)
    expect(summary.emailsPending).toBe(0)
    // The Phase 6 behaviour, unchanged: the 6 h alert is recorded and logged, not sent.
    expect(summary.emailsLogged).toBe(1)
    expect(logger.infos.some((m) => m.includes('SMTP_HOST is empty'))).toBe(true)
  })

  it('gives up after EMAIL_MAX_ATTEMPTS, and says so at warn', async () => {
    expect(EMAIL_MAX_ATTEMPTS).toBe(10)
    store.pending = [pendingOf('a1', 'c1', 6, EMAIL_MAX_ATTEMPTS - 1)]
    mailer.failuresLeft = 99

    await cycle(T0)
    expect(store.failed).toHaveLength(1)
    expect(logger.warns.some((m) => m.includes('giving up'))).toBe(true)
  })

  it('leaves the unique index alone: a second cycle fires nothing and emails nothing', async () => {
    store.cases = [caseAt('c1', 6)]
    await cycle(T0)
    const sentFirst = mailer.sent.length
    const again = await cycle(at(0.01))
    expect(again.alertsFired).toBe(0)
    expect(mailer.sent).toHaveLength(sentFirst)
    expect(store.alerts).toHaveLength(2)
  })
})
