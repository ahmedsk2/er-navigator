import { randomBytes } from 'node:crypto'
import type { User } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { afterAll, describe, expect, it } from 'vitest'
import { attemptLogin } from '@/src/lib/auth/login'
import { createSession } from '@/src/lib/auth/session'
import { SYSTEM_USERNAME } from '@/src/lib/auth/system-user'
import { prisma } from '@/src/lib/db'
import {
  runPasswordReset,
  ResetPasswordError,
  ResetPasswordUsageError,
  RESET_USER_AGENT,
} from '../../scripts/reset-password'

/**
 * P15.63, against a real Postgres with the OWNER role (cleaning up needs DELETE on User and
 * AuditLog, which the app role deliberately does not have).
 *
 * The claim this file has to earn is the one the runbook now makes: after
 * `node reset-password.js <username>` on the host, the person reads the printed password out,
 * signs in with it, and is sent straight to /account to set their own — and the lock that put
 * them there, their old password and every session they had are gone, with one audit row to say
 * it happened. So the assertions run the real sign-in service rather than re-reading columns.
 *
 * Cost-4 hashes for the password the account starts with: the reset's own hash is cost 12 and is
 * asserted in the unit suite; ten seconds of bcrypt here would buy nothing.
 */
const OLD_PASSWORD = 'the-password-nobody-remembers'
const created: string[] = []

async function makeUser(
  overrides: Partial<Pick<User, 'active' | 'failedLogins' | 'lockedUntil' | 'mustChangePassword'>> = {},
): Promise<User> {
  const user = await prisma.user.create({
    data: {
      username: `p15reset_${randomBytes(6).toString('hex')}`,
      passwordHash: await bcrypt.hash(OLD_PASSWORD, 4),
      displayName: 'Phase 15 reset target',
      role: 'ADMIN',
      active: overrides.active ?? true,
      failedLogins: overrides.failedLogins ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  })
  created.push(user.id)
  return user
}

/**
 * What the script is handed on the host: the owner URL, and nothing else it reads. (`NODE_ENV` is
 * required by the `ProcessEnv` type Next declares, not by the script.)
 */
const hostEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
})
const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => ({ NODE_ENV: process.env.NODE_ENV })

afterAll(async () => {
  if (created.length > 0) {
    // AuditLog.actorId is onDelete: Restrict, so the audit rows go first. Sessions cascade.
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } })
    await prisma.user.deleteMany({ where: { id: { in: created } } })
  }
  await prisma.$disconnect()
})

describe('reset-password on the host', () => {
  it('unlocks a locked-out admin, who then signs in with the printed password and must change it', async () => {
    // The situation the script exists for: the only administrator, locked out, signed in on a
    // phone somewhere, on a password nobody can produce.
    const admin = await makeUser({ failedLogins: 10, lockedUntil: new Date(Date.now() + 15 * 60_000) })
    await createSession({ userId: admin.id, ip: '10.0.0.15', userAgent: 'phone' })
    await createSession({ userId: admin.id, ip: '10.0.0.16', userAgent: 'ward desk' })
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(2)

    const printed: string[] = []
    const summary = await runPasswordReset({
      env: hostEnv(),
      argv: [admin.username],
      prisma,
      out: (line) => printed.push(line),
    })

    // ONE line, and it is the username and the password with nothing else on it.
    expect(printed).toEqual([`${admin.username} ${summary.temporaryPassword}`])

    // The lock and the failure count are cleared, and the sessions are gone.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(after.failedLogins).toBe(0)
    expect(after.lockedUntil).toBeNull()
    expect(after.mustChangePassword).toBe(true)
    expect(after.passwordHash).not.toBe(admin.passwordHash)
    expect(summary.sessionsDeleted).toBe(2)
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(0)

    // Exactly one audit row, actor = the system user, and it does not carry the password.
    const system = await prisma.user.findUniqueOrThrow({ where: { username: SYSTEM_USERNAME } })
    const audits = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: admin.id } })
    expect(audits.map((a) => a.action)).toEqual(['user.password'])
    expect(audits[0]!.actorId).toBe(system.id)
    expect(audits[0]!.userAgent).toBe(RESET_USER_AGENT)
    expect(audits[0]!.after).toMatchObject({
      username: admin.username,
      self: false,
      fromHost: true,
      mustChangePassword: true,
    })
    expect(JSON.stringify(audits[0]!.after)).not.toContain(summary.temporaryPassword)

    // The real sign-in service, with the printed password: it works, and the flag it comes back
    // with is what sends the user to /account before anything else.
    const signedIn = await attemptLogin({
      username: admin.username,
      password: summary.temporaryPassword,
      ip: '10.0.0.15',
      userAgent: 'vitest',
    })
    if (!signedIn.ok) throw new Error(`expected the temporary password to work, got ${signedIn.error}`)
    expect(signedIn.user.mustChangePassword).toBe(true)

    // And the old one no longer does.
    const old = await attemptLogin({
      username: admin.username,
      password: OLD_PASSWORD,
      ip: '10.0.0.15',
      userAgent: 'vitest',
    })
    expect(old).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('resets a deactivated account too, and leaves it deactivated', async () => {
    const user = await makeUser({ active: false })
    const summary = await runPasswordReset({
      env: hostEnv(),
      argv: [user.username],
      prisma,
      out: () => undefined,
    })
    expect(summary.username).toBe(user.username)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.active).toBe(false)
    expect(after.mustChangePassword).toBe(true)
    // Reactivating is still Admin → Users' decision, so the password alone does not let them in.
    const attempt = await attemptLogin({
      username: user.username,
      password: summary.temporaryPassword,
      ip: null,
      userAgent: null,
    })
    expect(attempt).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('finds the account whatever case the username was typed in', async () => {
    const user = await makeUser()
    const summary = await runPasswordReset({
      env: hostEnv(),
      argv: [`  ${user.username.toUpperCase()}  `],
      prisma,
      out: () => undefined,
    })
    expect(summary.username).toBe(user.username)
  })

  it('refuses an unknown username, and writes nothing', async () => {
    // Scoped to this script's own user agent: the database-backed files run in parallel, so a
    // whole-table count would be reading somebody else's work.
    const rowsBefore = await prisma.auditLog.count({ where: { userAgent: RESET_USER_AGENT } })
    await expect(
      runPasswordReset({ env: hostEnv(), argv: ['p15reset_nobody_here'], prisma, out: () => undefined }),
    ).rejects.toThrow(ResetPasswordError)
    expect(await prisma.auditLog.count({ where: { userAgent: RESET_USER_AGENT } })).toBe(rowsBefore)
  })

  it('refuses the system account, before it opens a connection or looks anything up', async () => {
    const rowsBefore = await prisma.auditLog.count({ where: { userAgent: RESET_USER_AGENT } })
    await expect(
      runPasswordReset({ env: hostEnv(), argv: [SYSTEM_USERNAME], prisma, out: () => undefined }),
    ).rejects.toThrow(/system/)
    expect(await prisma.auditLog.count({ where: { userAgent: RESET_USER_AGENT } })).toBe(rowsBefore)
  })

  it('refuses a missing DATABASE_URL, and asks for a username when it is given none', async () => {
    const user = await makeUser()
    await expect(
      runPasswordReset({ env: envWithoutDatabaseUrl(), argv: [user.username], prisma, out: () => undefined }),
    ).rejects.toThrow(/DATABASE_URL/)
    await expect(
      runPasswordReset({ env: hostEnv(), argv: [], prisma, out: () => undefined }),
    ).rejects.toThrow(ResetPasswordUsageError)
  })
})
