/**
 * The core of the change-password server action, split out for the same reason as attemptLogin:
 * a database test can drive it without a request.
 *
 * On success every OTHER session of that user is deleted and the caller's own session is
 * rotated, so a password change signs out the phone left on the ward desk but not the person
 * who just typed the new password.
 */
import { auditQuietly, type AuditContext } from '@/src/lib/audit'
import { hashPassword, verifyPassword } from '@/src/lib/auth/password'
import { createSession, deleteSessionsForUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'

export type ChangePasswordError = 'invalid_current' | 'same_password' | 'not_found'

export type ChangePasswordOutcome =
  | { ok: true; token: string; sessionsDeleted: number }
  | { ok: false; error: ChangePasswordError }

export async function changePassword(input: {
  userId: string
  currentPassword: string
  newPassword: string
  ip: string | null
  userAgent: string | null
  now?: Date
}): Promise<ChangePasswordOutcome> {
  const now = input.now ?? new Date()
  const ctx: AuditContext = { actorId: input.userId, ip: input.ip, userAgent: input.userAgent }

  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) return { ok: false, error: 'not_found' }

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await auditQuietly(
      { action: 'auth.fail', entity: 'User', entityId: user.id, after: { reason: 'wrong_current_password' } },
      ctx,
    )
    return { ok: false, error: 'invalid_current' }
  }
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    return { ok: false, error: 'same_password' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), failedLogins: 0, lockedUntil: null },
  })

  // Every session goes, including the caller's — then the caller gets a fresh one, so the
  // cookie that was in flight while the password was still the old one stops working.
  const sessionsDeleted = await deleteSessionsForUser(user.id)
  const { token } = await createSession({ userId: user.id, ip: input.ip, userAgent: input.userAgent, now })

  await auditQuietly(
    {
      action: 'user.password',
      entity: 'User',
      entityId: user.id,
      after: { username: user.username, self: true, sessionsDeleted },
    },
    ctx,
  )
  return { ok: true, token, sessionsDeleted }
}
