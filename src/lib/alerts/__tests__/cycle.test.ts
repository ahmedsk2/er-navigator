/**
 * The worker's rule, end to end, with an injected clock, a fake database and a fake mailer — the
 * five behaviours the Phase 6 spec names, plus the two the spec's idempotency clause implies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailResult, Mailer, OutgoingMessage } from '../email'
import { runAlertCycle, type AlertStore, type FireOutcome, type Logger, type Recipient } from '../cycle'
import type { AlertCase } from '../rules'

const HOUR = 36e5
const T0 = new Date('2026-09-09T00:00:00.000Z')
const at = (hours: number): Date => new Date(T0.getTime() + hours * HOUR)

type StoredAlert = { id: string; caseId: string; thresholdHours: number; emailSentAt: Date | null }

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
    this.alerts.push({ id, caseId: input.caseId, thresholdHours: input.thresholdHours, emailSentAt: null })
    this.updates.push({ caseId: input.caseId, thresholdHours: input.thresholdHours })
    return { fired: true, alertId: id }
  }

  async markEmailSent(alertId: string, sentAt: Date): Promise<void> {
    const row = this.alerts.find((a) => a.id === alertId)
    if (row) row.emailSentAt = sentAt
  }

  async recipients(): Promise<Recipient[]> {
    this.recipientLookups += 1
    return this.people
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

const sleep = vi.fn(async () => undefined)

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
    store.alerts.push({ id: 'other', caseId: 'c1', thresholdHours: 6, emailSentAt: null })
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
