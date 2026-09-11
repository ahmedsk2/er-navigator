/**
 * The core of the login server action: everything except the form, the cookie and the redirect,
 * so it can be exercised against a real database (tests/db/auth.test.ts) without a request.
 *
 * Order matters and is the spec's, section 3:
 *   1. bcrypt always runs, against the user's hash or the dummy one, so the response time is the
 *      same whether or not the username exists.
 *   2. A locked account is told it is locked and nothing is counted against it.
 *   3. A wrong password, an unknown username and a deactivated account all answer "invalid" —
 *      one message, so the form cannot be used to enumerate staff or spot deactivations.
 *   4. Every outcome writes an audit row; none of them ever writes the password.
 */
import { auditQuietly, type AuditContext } from '@/src/lib/audit'
import { isLocked, LOCKOUT_MINUTES, lockMinutesRemaining, registerFailure } from '@/src/lib/auth/lockout'
import { verifyPassword } from '@/src/lib/auth/password'
import { createSession, type AuthUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'

export type LoginError = 'invalid' | 'locked' | 'rate_limited'

export type LoginOutcome =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; error: LoginError; lockedMinutes?: number }

export type LoginAttempt = {
  username: string
  password: string
  ip: string | null
  userAgent: string | null
  now?: Date
}

/** Audit row for an attempt that never got as far as looking a user up. */
export async function auditRateLimited(username: string, ctx: AuditContext): Promise<void> {
  await auditQuietly(
    { action: 'auth.fail', entity: 'User', entityId: null, after: { username, reason: 'rate_limited' } },
    ctx,
  )
}

export async function attemptLogin(attempt: LoginAttempt): Promise<LoginOutcome> {
  const now = attempt.now ?? new Date()
  const ctx = (actorId: string | null): AuditContext => ({
    actorId,
    ip: attempt.ip,
    userAgent: attempt.userAgent,
  })

  const user = await prisma.user.findUnique({ where: { username: attempt.username } })

  // Always one bcrypt comparison, before any branch that could return early on a fast path.
  const passwordMatches = await verifyPassword(attempt.password, user?.passwordHash ?? null)

  if (user && isLocked(user.lockedUntil, now)) {
    await auditQuietly(
      {
        action: 'auth.locked',
        entity: 'User',
        entityId: user.id,
        after: { username: user.username, reason: 'attempt_while_locked' },
      },
      ctx(user.id),
    )
    return { ok: false, error: 'locked', lockedMinutes: lockMinutesRemaining(user.lockedUntil, now) }
  }

  if (!user || !user.active || !passwordMatches) {
    const reason = !user ? 'unknown_user' : !user.active ? 'inactive_user' : 'bad_password'
    if (user) {
      const failure = registerFailure(user.failedLogins, now)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failure.failedLogins,
          ...(failure.locked ? { lockedUntil: failure.lockedUntil } : {}),
        },
      })
      if (failure.locked) {
        await auditQuietly(
          {
            action: 'auth.locked',
            entity: 'User',
            entityId: user.id,
            after: { username: user.username, reason: 'failed_attempts', minutes: LOCKOUT_MINUTES },
          },
          ctx(user.id),
        )
      }
    }
    await auditQuietly(
      { action: 'auth.fail', entity: 'User', entityId: user?.id ?? null, after: { username: attempt.username, reason } },
      ctx(user?.id ?? null),
    )
    return { ok: false, error: 'invalid' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
  })
  const { token } = await createSession({ userId: user.id, ip: attempt.ip, userAgent: attempt.userAgent, now })
  await auditQuietly(
    { action: 'auth.login', entity: 'User', entityId: user.id, after: { username: user.username } },
    ctx(user.id),
  )

  return {
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      lastShift: user.lastShift,
      mustChangePassword: user.mustChangePassword,
    },
  }
}
