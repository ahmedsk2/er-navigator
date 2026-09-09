import { randomBytes } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { afterAll, describe, expect, it } from 'vitest'
import type { AuditContext } from '@/src/lib/audit'
import { changePassword } from '@/src/lib/auth/account'
import { isLocked, LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '@/src/lib/auth/lockout'
import { attemptLogin } from '@/src/lib/auth/login'
import { verifyPassword } from '@/src/lib/auth/password'
import {
  assertCan,
  createSession,
  ForbiddenError,
  hashSessionToken,
  resolveSessionToken,
  SESSION_TTL_MS,
  type AuthUser,
} from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'

/**
 * Database-backed auth tests. Runs against the dev compose Postgres with the OWNER role, because
 * cleaning up needs DELETE on User and AuditLog, which the app role deliberately does not have.
 *
 * Cost-4 hashes: these tests care about the flow, not about bcrypt's work factor (that is
 * asserted in src/lib/auth/__tests__/password.test.ts), and ten failed logins at cost 12 would
 * add ten seconds to the suite for nothing.
 */
const PASSWORD = 'a-correct-passphrase'
const created: string[] = []

async function makeUser(overrides: Partial<Pick<User, 'role' | 'active' | 'lockedUntil' | 'failedLogins'>> = {}) {
  const user = await prisma.user.create({
    data: {
      username: `p1test_${randomBytes(6).toString('hex')}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      displayName: 'Phase 1 Test',
      role: (overrides.role ?? 'NAVIGATOR') as Role,
      active: overrides.active ?? true,
      lockedUntil: overrides.lockedUntil ?? null,
      failedLogins: overrides.failedLogins ?? 0,
    },
  })
  created.push(user.id)
  return user
}

function authUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastShift: user.lastShift,
  }
}

const ctxFor = (id: string | null): AuditContext => ({ actorId: id, ip: '10.0.0.9', userAgent: 'vitest' })

afterAll(async () => {
  if (created.length > 0) {
    // AuditLog.actorId is onDelete: Restrict, so the audit rows go first. Sessions cascade.
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } })
    await prisma.user.deleteMany({ where: { id: { in: created } } })
  }
  await prisma.$disconnect()
})

describe('login', () => {
  it('creates a session row and an auth.login audit row, and stores only the hash', async () => {
    const user = await makeUser()
    const outcome = await attemptLogin({
      username: user.username,
      password: PASSWORD,
      ip: '10.0.0.9',
      userAgent: 'vitest',
    })
    if (!outcome.ok) throw new Error(`expected a successful login, got ${outcome.error}`)

    const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(outcome.token) } })
    expect(session).not.toBeNull()
    expect(session!.userId).toBe(user.id)
    expect(session!.ip).toBe('10.0.0.9')
    expect(session!.expiresAt.getTime() - session!.createdAt.getTime()).toBe(SESSION_TTL_MS)

    // The raw cookie value is nowhere in the table.
    expect(await prisma.session.findFirst({ where: { tokenHash: outcome.token } })).toBeNull()

    const logins = await prisma.auditLog.findMany({ where: { actorId: user.id, action: 'auth.login' } })
    expect(logins).toHaveLength(1)
    expect(logins[0]!.entity).toBe('User')
    expect(logins[0]!.entityId).toBe(user.id)
    expect(JSON.stringify(logins[0]!.after)).not.toContain(PASSWORD)

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(refreshed.lastLoginAt).not.toBeNull()
    expect(refreshed.failedLogins).toBe(0)
  })

  it('answers "invalid" and audits auth.fail for a wrong password', async () => {
    const user = await makeUser()
    const outcome = await attemptLogin({ username: user.username, password: 'nope', ip: null, userAgent: null })
    expect(outcome).toMatchObject({ ok: false, error: 'invalid' })
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    const fails = await prisma.auditLog.findMany({ where: { actorId: user.id, action: 'auth.fail' } })
    expect(fails).toHaveLength(1)
  })

  it('answers "invalid" for an unknown username and for a deactivated user alike', async () => {
    const unknown = await attemptLogin({ username: 'p1test_nobody_here', password: PASSWORD, ip: null, userAgent: null })
    expect(unknown).toMatchObject({ ok: false, error: 'invalid' })

    const inactive = await makeUser({ active: false })
    const deactivated = await attemptLogin({
      username: inactive.username,
      password: PASSWORD,
      ip: null,
      userAgent: null,
    })
    expect(deactivated).toMatchObject({ ok: false, error: 'invalid' })
    expect(await prisma.session.count({ where: { userId: inactive.id } })).toBe(0)
  })

  it('locks the account after ten failures, audits auth.locked, and stays locked for a correct password', async () => {
    const user = await makeUser()
    for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt += 1) {
      const outcome = await attemptLogin({ username: user.username, password: 'nope', ip: null, userAgent: null })
      expect(outcome).toMatchObject({ ok: false, error: 'invalid' })
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(isLocked(locked.lockedUntil, new Date())).toBe(true)
    expect(locked.failedLogins).toBe(0)
    const minutesOut = (locked.lockedUntil!.getTime() - Date.now()) / 60_000
    expect(minutesOut).toBeGreaterThan(LOCKOUT_MINUTES - 1)
    expect(minutesOut).toBeLessThanOrEqual(LOCKOUT_MINUTES)

    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.fail' } })).toBe(MAX_FAILED_LOGINS)
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.locked' } })).toBe(1)

    const withRightPassword = await attemptLogin({
      username: user.username,
      password: PASSWORD,
      ip: null,
      userAgent: null,
    })
    expect(withRightPassword).toMatchObject({ ok: false, error: 'locked' })
    expect((withRightPassword as { lockedMinutes?: number }).lockedMinutes).toBeGreaterThan(0)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    // An attempt while locked is audited but does not count against the user again.
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.locked' } })).toBe(2)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLogins).toBe(0)
  }, 30_000)

  it('a successful login clears an expired lock and the failure counter', async () => {
    const user = await makeUser({ failedLogins: 4, lockedUntil: new Date(Date.now() - 60_000) })
    const outcome = await attemptLogin({ username: user.username, password: PASSWORD, ip: null, userAgent: null })
    expect(outcome.ok).toBe(true)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.failedLogins).toBe(0)
    expect(after.lockedUntil).toBeNull()
  })
})

describe('session resolution', () => {
  it('resolves a live session to its user, without the password hash', async () => {
    const user = await makeUser()
    const { token } = await createSession({ userId: user.id, ip: null, userAgent: null })
    const current = await resolveSessionToken(token)
    expect(current?.user.id).toBe(user.id)
    expect(current?.user).not.toHaveProperty('passwordHash')
  })

  it('refuses and deletes an expired session', async () => {
    const user = await makeUser()
    const { token, sessionId } = await createSession({
      userId: user.id,
      ip: null,
      userAgent: null,
      now: new Date(Date.now() - SESSION_TTL_MS - 60_000),
    })
    expect(await resolveSessionToken(token)).toBeNull()
    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull()
  })

  it('refuses and deletes the session of a deactivated user', async () => {
    const user = await makeUser()
    const { token, sessionId } = await createSession({ userId: user.id, ip: null, userAgent: null })
    await prisma.user.update({ where: { id: user.id }, data: { active: false } })
    expect(await resolveSessionToken(token)).toBeNull()
    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull()
  })

  it('slides lastSeenAt and expiresAt once the session is more than five minutes old', async () => {
    const user = await makeUser()
    const stale = new Date(Date.now() - 6 * 60_000)
    const { token, sessionId } = await createSession({ userId: user.id, ip: null, userAgent: null, now: stale })
    const before = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })

    const current = await resolveSessionToken(token)
    expect(current).not.toBeNull()
    const after = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime())
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime())

    // A second look inside the five-minute window does not write again.
    await resolveSessionToken(token)
    const again = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
    expect(again.lastSeenAt.getTime()).toBe(after.lastSeenAt.getTime())
  })

  it('resolves nothing for a token that was never issued', async () => {
    expect(await resolveSessionToken('not-a-real-token')).toBeNull()
  })
})

describe('role gate', () => {
  it('a VIEWER on case.create is refused and audited as auth.forbidden', async () => {
    const viewer = await makeUser({ role: 'VIEWER' })
    await expect(assertCan(authUser(viewer), 'case.create', ctxFor(viewer.id))).rejects.toBeInstanceOf(ForbiddenError)

    const rows = await prisma.auditLog.findMany({ where: { actorId: viewer.id, action: 'auth.forbidden' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entity).toBe('Action')
    expect(rows[0]!.entityId).toBe('case.create')
    expect(rows[0]!.after).toMatchObject({ role: 'VIEWER' })
  })

  it('a VIEWER on case.view passes and writes nothing', async () => {
    const viewer = await makeUser({ role: 'VIEWER' })
    await expect(assertCan(authUser(viewer), 'case.view', ctxFor(viewer.id))).resolves.toBeUndefined()
    expect(await prisma.auditLog.count({ where: { actorId: viewer.id } })).toBe(0)
  })

  it('a NAVIGATOR on admin.users is refused too', async () => {
    const navigator = await makeUser({ role: 'NAVIGATOR' })
    await expect(assertCan(authUser(navigator), 'admin.users', ctxFor(navigator.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('change password', () => {
  it('replaces the hash, signs every other device out, rotates this one, and audits user.password', async () => {
    const user = await makeUser()
    await createSession({ userId: user.id, ip: null, userAgent: null })
    await createSession({ userId: user.id, ip: null, userAgent: null })
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2)

    const outcome = await changePassword({
      userId: user.id,
      currentPassword: PASSWORD,
      newPassword: 'a-brand-new-passphrase',
      ip: null,
      userAgent: null,
    })
    if (!outcome.ok) throw new Error(`expected the change to succeed, got ${outcome.error}`)
    expect(outcome.sessionsDeleted).toBe(2)

    const sessions = await prisma.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(outcome.token))

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword('a-brand-new-passphrase', after.passwordHash)).toBe(true)
    expect(await verifyPassword(PASSWORD, after.passwordHash)).toBe(false)

    const audits = await prisma.auditLog.findMany({ where: { actorId: user.id, action: 'user.password' } })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0]!.after)).not.toContain('a-brand-new-passphrase')
  }, 20_000)

  it('refuses a wrong current password, changes nothing, and audits the failure', async () => {
    const user = await makeUser()
    const outcome = await changePassword({
      userId: user.id,
      currentPassword: 'not-my-password',
      newPassword: 'a-brand-new-passphrase',
      ip: null,
      userAgent: null,
    })
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_current' })
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword(PASSWORD, after.passwordHash)).toBe(true)
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.fail' } })).toBe(1)
  })

  it('refuses a new password identical to the current one', async () => {
    const user = await makeUser()
    const outcome = await changePassword({
      userId: user.id,
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
      ip: null,
      userAgent: null,
    })
    expect(outcome).toMatchObject({ ok: false, error: 'same_password' })
  })
})
