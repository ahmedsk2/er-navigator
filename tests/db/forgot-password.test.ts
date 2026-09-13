import { randomBytes } from 'node:crypto'
import type { User } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { afterAll, describe, expect, it } from 'vitest'
import { drainOutbox } from '@/src/lib/alerts/outbox'
import { prismaOutboxStore } from '@/src/lib/alerts/store'
import { RESET_RESPONSE_FLOOR_MS, withConstantTimeFloor } from '@/src/lib/auth/constant-time'
import {
  completePasswordReset,
  requestPasswordReset,
  resetTokenIsLive,
  RESET_REQUESTED_MESSAGE,
} from '@/src/lib/auth/forgot-password'
import {
  prismaCompleteResetStore,
  prismaForgotPasswordStore,
} from '@/src/lib/auth/forgot-password-store'
import { attemptLogin } from '@/src/lib/auth/login'
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  RESET_REQUESTS_PER_HOUR,
} from '@/src/lib/auth/reset-token'
import { createSession } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'

/**
 * Phase 16 (docs/specs/phase16-forgot-password.md, section 8) against a real Postgres with the
 * OWNER role — cleaning up needs DELETE on User and AuditLog, which the app role deliberately
 * does not have.
 *
 * What this file has to earn is the claim the runbook and the login page now make: a person taps
 * "Forgot your password?", a link arrives, and the link sets a password that works. So the
 * assertions run the real sign-in service rather than re-reading columns, exactly as
 * tests/db/reset-password.test.ts does for the host script.
 *
 * Everything is scoped to the accounts this file creates: the database-backed suite runs in
 * parallel with its siblings, so a whole-table count here would be reading somebody else's work.
 *
 * Cost-4 hashes for the password an account starts with; the reset's own hash is cost 12 and the
 * unit suite asserts that.
 */
const OLD_PASSWORD = 'the-password-they-forgot'
const APP_URL = 'https://nav.towardpcc.com'
const IP = '203.0.113.44'
const CTX = { actorId: null, ip: IP, userAgent: 'vitest' }

const created: string[] = []
const outboxIds: string[] = []

async function makeUser(
  overrides: Partial<Pick<User, 'active' | 'email' | 'lockedUntil' | 'failedLogins'>> = {},
): Promise<User> {
  const tag = randomBytes(6).toString('hex')
  const user = await prisma.user.create({
    data: {
      username: `p16_${tag}`,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 4),
      displayName: 'Phase 16 target',
      role: 'NAVIGATOR',
      active: overrides.active ?? true,
      email: overrides.email === undefined ? `p16_${tag}@example.invalid` : overrides.email,
      failedLogins: overrides.failedLogins ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
    },
  })
  created.push(user.id)
  return user
}

const requestStore = () => prismaForgotPasswordStore(CTX)
const completeStore = () => prismaCompleteResetStore({ ip: IP, userAgent: 'vitest' })

/**
 * The raw token of the link this account was last sent, read the way a person reads their mail.
 *
 * Matched by digest rather than by timestamp: two rows can share a millisecond, and the whole
 * point of the token is that the row and the mail agree about it. `Outbox` has no user column
 * on purpose, so the address is what narrows the search.
 */
async function linkFor(user: { id: string; email: string | null }): Promise<{
  token: string
  text: string
  outboxId: string
}> {
  const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } })
  const rows = await prisma.outbox.findMany({ where: { to: user.email ?? '' } })
  for (const row of rows) {
    const raw = /\/reset\?token=([A-Za-z0-9_%-]+)/.exec(row.text)?.[1]
    if (!raw) continue
    const token = decodeURIComponent(raw)
    const match = tokens.find((t) => t.tokenHash === hashResetToken(token) && t.usedAt === null)
    if (match) return { token, text: row.text, outboxId: row.id }
  }
  throw new Error('[p16] no live link in the outbox for that account')
}

afterAll(async () => {
  if (created.length > 0) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: created } } })
    await prisma.session.deleteMany({ where: { userId: { in: created } } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] },
    })
    await prisma.user.deleteMany({ where: { id: { in: created } } })
  }
  if (outboxIds.length > 0) await prisma.outbox.deleteMany({ where: { id: { in: outboxIds } } })
  await prisma.$disconnect()
})

describe('asking for a link', () => {
  it('writes one token, one outbox row and one audit row, and nothing that carries the token', async () => {
    const user = await makeUser()
    const answer = await requestPasswordReset(user.username, IP, {
      store: requestStore(),
      appUrl: APP_URL,
    })
    expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } })
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.usedAt).toBeNull()
    expect(tokens[0]!.requestedIp).toBe(IP)
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000)
    expect(tokens[0]!.tokenHash).toHaveLength(64)

    const { token, text, outboxId } = await linkFor(user)
    outboxIds.push(outboxId)
    const outbox = await prisma.outbox.findUniqueOrThrow({ where: { id: outboxId } })
    expect(outbox.to).toBe(user.email)
    expect(outbox.sentAt).toBeNull()
    expect(outbox.attempts).toBe(0)
    // The digest in the row is of the token in the mail, and the mail is the only place it is.
    expect(hashResetToken(token)).toBe(tokens[0]!.tokenHash)
    expect(text).toContain(`${APP_URL}/reset?token=`)
    expect(text).not.toContain(user.username)
    expect(text).not.toContain(user.email!)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: user.id } })
    expect(audits.map((a) => a.action)).toEqual(['auth.reset.requested'])
    expect(audits[0]!.after).toEqual({ requested: true })
    expect(audits[0]!.actorId).toBeNull()
    expect(JSON.stringify(audits[0]!.after)).not.toContain(token)
    expect(JSON.stringify(audits[0]!.after)).not.toContain(tokens[0]!.tokenHash)
  })

  it('writes nothing at all for an unknown user, a deactivated one or one with no email', async () => {
    const inactive = await makeUser({ active: false })
    const noEmail = await makeUser({ email: null })

    for (const username of ['p16_nobody_here', inactive.username, noEmail.username]) {
      const answer = await requestPasswordReset(username, IP, {
        store: requestStore(),
        appUrl: APP_URL,
      })
      expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)
    }
    for (const user of [inactive, noEmail]) {
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0)
      expect(await prisma.auditLog.count({ where: { entityId: user.id } })).toBe(0)
    }
  })

  it('kills the earlier link when a second one is asked for, and ignores the fourth in an hour', async () => {
    const user = await makeUser()
    const ask = () => requestPasswordReset(user.username, IP, { store: requestStore(), appUrl: APP_URL })

    await ask()
    const first = await linkFor(user)
    outboxIds.push(first.outboxId)
    await ask()
    const second = await linkFor(user)
    outboxIds.push(second.outboxId)
    expect(second.token).not.toBe(first.token)

    // The first link is dead the moment the second is issued.
    expect(await resetTokenIsLive({ store: completeStore(), token: first.token })).toBe(false)
    expect(await resetTokenIsLive({ store: completeStore(), token: second.token })).toBe(true)

    await ask()
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(
      RESET_REQUESTS_PER_HOUR,
    )
    // The fourth within the hour writes nothing: no token, no mail, no audit row.
    const mailBefore = await prisma.outbox.count({ where: { to: user.email! } })
    await ask()
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(
      RESET_REQUESTS_PER_HOUR,
    )
    expect(await prisma.outbox.count({ where: { to: user.email! } })).toBe(mailBefore)
    expect(await prisma.auditLog.count({ where: { entityId: user.id } })).toBe(RESET_REQUESTS_PER_HOUR)
    for (const row of await prisma.outbox.findMany({ where: { to: user.email! } })) outboxIds.push(row.id)
  })

  /**
   * P16.40, raised by the security review of 13 September and confirmed by all three refuters.
   *
   * The three-an-hour rule was a count read before the write and outside its transaction, so
   * eight requests that arrive together each read the same "none yet" and each write a link: the
   * reviewer's probe got eight tokens, seven of them live at some point, and eight mails. The
   * count and the insert are one decision now, taken under a row lock on the account, so the
   * rule holds however many requests arrive at once.
   *
   * The assertions are bounds rather than equalities on purpose: what the rule promises is a
   * ceiling on the mail somebody can cause, and exactly one link that still works.
   */
  it('holds the three-an-hour rule against eight requests that arrive at once', async () => {
    const user = await makeUser()
    const answers = await Promise.all(
      Array.from({ length: 8 }, () =>
        requestPasswordReset(user.username, IP, { store: requestStore(), appUrl: APP_URL }),
      ),
    )
    // Whatever the race did, every caller was told the same thing.
    for (const answer of answers) expect(answer.message).toBe(RESET_REQUESTED_MESSAGE)

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } })
    const mail = await prisma.outbox.findMany({ where: { to: user.email! } })
    for (const row of mail) outboxIds.push(row.id)

    expect(tokens.length, 'more links than the hour allows').toBeLessThanOrEqual(
      RESET_REQUESTS_PER_HOUR,
    )
    expect(mail.length, 'more mail than the hour allows').toBeLessThanOrEqual(RESET_REQUESTS_PER_HOUR)
    expect(
      await prisma.auditLog.count({ where: { entityId: user.id } }),
      'more audit rows than links',
    ).toBeLessThanOrEqual(RESET_REQUESTS_PER_HOUR)
    // The one that matters: a person who asked eight times has exactly one link that works.
    expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1)
  })
})

/**
 * P16.41. The clock was the enumeration channel the sentence could not close: a miss returned
 * before any write and a hit paid for a transaction, about 1 ms against 10 in process. Both are
 * held to the same floor now, the way `/login` has always run bcrypt for a username nobody has.
 *
 * This is the composition the server action runs, against a real Postgres, so what it times is
 * the real write and not a fake.
 */
describe('the constant-time envelope on a real database', () => {
  it('answers a real account and an unknown one at the same speed', async () => {
    const user = await makeUser()
    const askFloored = async (username: string): Promise<number> => {
      const started = performance.now()
      await withConstantTimeFloor(() =>
        requestPasswordReset(username, IP, { store: requestStore(), appUrl: APP_URL }),
      )
      return performance.now() - started
    }

    const hit = await askFloored(user.username)
    const miss = await askFloored('p16_nobody_has_this_name')
    for (const row of await prisma.outbox.findMany({ where: { to: user.email! } })) {
      outboxIds.push(row.id)
    }

    // A 1 ms allowance on each: `performance.now()` and `setTimeout` do not agree to the tick.
    expect(hit, 'the hit path answered before the floor').toBeGreaterThanOrEqual(
      RESET_RESPONSE_FLOOR_MS - 1,
    )
    expect(miss, 'the miss path answered before the floor').toBeGreaterThanOrEqual(
      RESET_RESPONSE_FLOOR_MS - 1,
    )
    // What is left between them is scheduling noise, not a database write. The tolerance is a
    // third of the floor rather than the ~9 ms the review measured, because a shared CI runner
    // hiccups and the claim being made is that the difference no longer tracks the work.
    expect(
      Math.abs(hit - miss),
      'a real account and an unknown one are still distinguishable by the clock',
    ).toBeLessThan(RESET_RESPONSE_FLOOR_MS / 3)
  })
})

describe('spending the link', () => {
  it('changes the password, signs every device out, spends the token and leaves one audit row', async () => {
    const user = await makeUser({ failedLogins: 7, lockedUntil: new Date(Date.now() + 15 * 60_000) })
    await createSession({ userId: user.id, ip: '10.0.0.1', userAgent: 'phone' })
    await createSession({ userId: user.id, ip: '10.0.0.2', userAgent: 'ward desk' })

    await requestPasswordReset(user.username, IP, { store: requestStore(), appUrl: APP_URL })
    const { token, outboxId } = await linkFor(user)
    outboxIds.push(outboxId)

    const chosen = 'a-password-only-they-know'
    const outcome = await completePasswordReset({ store: completeStore(), token, newPassword: chosen })
    expect(outcome).toMatchObject({ ok: true, userId: user.id, sessionsDeleted: 2 })

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.failedLogins).toBe(0)
    expect(after.lockedUntil).toBeNull()
    // The user chose this password, so nothing is owed at the next sign-in.
    expect(after.mustChangePassword).toBe(false)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } })).usedAt)
      .not.toBeNull()

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'User', entityId: user.id },
      orderBy: { at: 'asc' },
    })
    expect(audits.map((a) => a.action)).toEqual(['auth.reset.requested', 'user.password'])
    expect(audits[1]!.actorId).toBe(user.id)
    expect(audits[1]!.after).toMatchObject({
      username: user.username,
      self: true,
      via: 'email-reset',
      mustChangePassword: false,
    })
    expect(JSON.stringify(audits[1]!.after)).not.toContain(chosen)
    expect(JSON.stringify(audits[1]!.after)).not.toContain(token)

    // The real sign-in service: the new password works and lands nowhere special, and the old
    // one is dead.
    const signedIn = await attemptLogin({ username: user.username, password: chosen, ip: IP, userAgent: 'vitest' })
    if (!signedIn.ok) throw new Error(`expected the chosen password to work, got ${signedIn.error}`)
    expect(signedIn.user.mustChangePassword).toBe(false)
    expect(
      await attemptLogin({ username: user.username, password: OLD_PASSWORD, ip: IP, userAgent: 'vitest' }),
    ).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('refuses the same link a second time, and does not touch the password', async () => {
    const user = await makeUser()
    await requestPasswordReset(user.username, IP, { store: requestStore(), appUrl: APP_URL })
    const { token, outboxId } = await linkFor(user)
    outboxIds.push(outboxId)

    const first = 'the-first-password-they-chose'
    expect(await completePasswordReset({ store: completeStore(), token, newPassword: first })).toMatchObject({
      ok: true,
    })
    const hashAfterFirst = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash

    expect(
      await completePasswordReset({ store: completeStore(), token, newPassword: 'somebody-elses-password' }),
    ).toEqual({ ok: false, error: 'invalid' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(
      hashAfterFirst,
    )
  })

  it('refuses an expired link and an invented one, with the same answer', async () => {
    const user = await makeUser()
    const expired = generateResetToken()
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(expired),
        expiresAt: resetTokenExpiry(new Date(Date.now() - 61 * 60_000)),
        requestedIp: IP,
      },
    })

    for (const token of [expired, generateResetToken()]) {
      expect(await resetTokenIsLive({ store: completeStore(), token })).toBe(false)
      expect(
        await completePasswordReset({ store: completeStore(), token, newPassword: 'a-long-enough-password' }),
      ).toEqual({ ok: false, error: 'invalid' })
    }
    expect(
      await attemptLogin({ username: user.username, password: OLD_PASSWORD, ip: IP, userAgent: 'vitest' }),
    ).toMatchObject({ ok: true })
  })
})

describe('the worker draining the outbox', () => {
  it('stamps sentAt in log-only mode, which is the demo, and logs no token', async () => {
    const user = await makeUser()
    await requestPasswordReset(user.username, IP, { store: requestStore(), appUrl: APP_URL })
    const { token, outboxId } = await linkFor(user)
    outboxIds.push(outboxId)

    const lines: string[] = []
    const logger = {
      info: (m: string, d?: unknown) => lines.push(`${m} ${JSON.stringify(d ?? '')}`),
      warn: (m: string, d?: unknown) => lines.push(`${m} ${JSON.stringify(d ?? '')}`),
      error: (m: string, d?: unknown) => lines.push(`${m} ${JSON.stringify(d ?? '')}`),
    }
    // The store reads the whole queue, so this run may carry a sibling test's rows too; the
    // assertion below is about THIS row.
    await drainOutbox({ store: prismaOutboxStore(), mailer: null, logger, now: new Date(), limit: 50 })

    const row = await prisma.outbox.findUniqueOrThrow({ where: { id: outboxId } })
    expect(row.sentAt).not.toBeNull()
    expect(row.attempts).toBe(0)
    expect(row.lastError).toBeNull()
    expect(lines.some((l) => l.includes('[outbox]') && l.includes('would have emailed'))).toBe(true)
    for (const line of lines) expect(line).not.toContain(token)

    // Drained once: a second poll does not pick it up again.
    const before = row.sentAt
    await drainOutbox({ store: prismaOutboxStore(), mailer: null, logger, now: new Date(), limit: 50 })
    expect((await prisma.outbox.findUniqueOrThrow({ where: { id: outboxId } })).sentAt).toEqual(before)
  })
})

describe('the app role', () => {
  /**
   * The app must be able to append and the worker must be able to stamp. The other half of the
   * rule — that neither may DELETE — is asserted where it can be asserted without a race:
   * `tests/db/demo-seed.test.ts` is the only file that widens `public` (its `migrate deploy` into
   * another schema replays the privileges migration, whose GRANTs name `public` literally), it
   * narrows it again immediately, and its own last test reads the list back. CI's privilege guard
   * reads it once more after the whole suite. Asserting the revoke here would be reading that
   * file's half-second window from a sibling running in parallel.
   */
  it('may append to the outbox and stamp a row, which is all it needs', async () => {
    const rows = await prisma.$queryRaw<Array<{ present: boolean; can: boolean | null }>>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ernav_app') AS present,
             (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ernav_app')
                          THEN has_table_privilege('ernav_app', '"Outbox"', 'INSERT')
                           AND has_table_privilege('ernav_app', '"Outbox"', 'UPDATE') END) AS can`
    const row = rows[0]!
    // On a database where the role has not been reconciled there is nothing to assert; CI and the
    // local chain both run prisma/sync-app-role.ts before this suite.
    if (!row.present) return
    expect(row.can).toBe(true)
  })
})
