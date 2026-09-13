/**
 * The one password reset, used by Admin → Users, by the host-side script (Phase 15, P15.63) and,
 * since Phase 16, by the emailed "Forgot your password?" link.
 *
 * Admin → Users is where a password is reset on a normal day. The exception this module exists
 * for is the one the runbook used to answer with hand-written bcrypt and hand-written SQL: every
 * ADMIN is locked out, or nobody remembers the admin password, and there is no screen left to
 * press the button on. `scripts/reset-password.ts` runs the same reset from the host, so the two
 * paths cannot drift — same generator, same bcrypt cost, same flags cleared, same sessions
 * deleted, same `user.password` audit row.
 *
 * WHY IT IS A PORT rather than a function that takes a Prisma client. `PasswordResetStore` is the
 * `AlertStore` pattern (src/lib/alerts/cycle.ts): the rule — generate, hash, apply, sign out
 * everywhere — is asserted in the unit suite against a fake, and the Prisma implementation below
 * is asserted against a real Postgres in tests/db/reset-password.test.ts.
 *
 * WHY IT IS NOT IN src/lib/admin/users.ts. That file imports `@/src/lib/auth/session`, which
 * imports `next/headers` and `next/navigation`. esbuild bundles this file into a plain-Node
 * script that runs inside the app container with no Next runtime, so everything it reaches has to
 * stay clear of the framework — the same rule scripts/demo-seed.ts follows.
 *
 * The plaintext password is returned to the caller once and is never stored, logged or audited.
 */
import { randomInt } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { audit, type AuditContext } from '@/src/lib/audit'
import { hashPassword } from '@/src/lib/auth/password'
import { prisma } from '@/src/lib/db'

// No i, l, o, 0 or 1: this is read out loud across a ward desk before it is typed in.
const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const TEMPORARY_PASSWORD_LENGTH = 16

export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]
  return out
}

/**
 * Who did it, as the audit row will say. `self` is false for the two paths where somebody else
 * produced the password and read it out; it is true for the Phase 16 email reset, where the user
 * typed a password only they know — the one case that is not a temporary credential.
 */
export type ResetOrigin =
  | { by: 'admin'; adminUsername: string }
  /** The host-side script: no signed-in actor, so the `system` user is the actor on the row. */
  | { by: 'host' }
  /**
   * Phase 16: the user followed a one-time link from their own mailbox and chose the password
   * themselves (docs/specs/phase16-forgot-password.md).
   */
  | { by: 'email' }

/**
 * Does this reset leave the account owing a password change?
 *
 * Yes for the two paths that hand out a temporary password somebody else has read (Phase 12).
 * No for the email reset: the user has just set a password only they know, and sending them
 * straight to /account to set another one would be theatre.
 */
export function mustChangeAfterReset(origin: ResetOrigin): boolean {
  return origin.by !== 'email'
}

/** The `after` payload of the `user.password` row. Never the password, in any shape. */
export function resetAuditAfter(username: string, origin: ResetOrigin): Record<string, unknown> {
  if (origin.by === 'email') {
    return { username, self: true, via: 'email-reset', mustChangePassword: false }
  }
  return {
    username,
    self: false,
    ...(origin.by === 'admin' ? { byAdmin: origin.adminUsername } : { fromHost: true }),
    mustChangePassword: true,
  }
}

export type ApplyResetInput = {
  userId: string
  username: string
  passwordHash: string
  origin: ResetOrigin
}

export type PasswordResetStore = {
  /**
   * The new hash, `failedLogins` back to 0, `lockedUntil` cleared, `mustChangePassword` set from
   * the origin (`mustChangeAfterReset`), and the `user.password` audit row — one transaction, so
   * the row and the change land together.
   */
  apply(input: ApplyResetInput): Promise<void>
  /** Every session of that user: the phone on the ward desk stops working now, not in 12 hours. */
  deleteSessions(userId: string): Promise<number>
}

export type PasswordResetResult = { temporaryPassword: string; sessionsDeleted: number }

/**
 * Reset one account's password. The caller has already decided the target exists and may be
 * reset (Admin → Users refuses the system account and checks the permission; the host script
 * refuses the system account too).
 */
export async function resetPassword(
  store: PasswordResetStore,
  target: { id: string; username: string },
  origin: ResetOrigin,
): Promise<PasswordResetResult> {
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  await store.apply({ userId: target.id, username: target.username, passwordHash, origin })
  // After the transaction, exactly as the admin path has always done it: a failed session delete
  // must not roll back a password that has already been read out.
  const sessionsDeleted = await store.deleteSessions(target.id)
  return { temporaryPassword, sessionsDeleted }
}

/**
 * Phase 16: the same write, for a password the USER chose off a one-time link rather than one
 * this module generated (docs/specs/phase16-forgot-password.md, section 5).
 *
 * Deliberately the same port and the same store, so there is still exactly one place in this
 * application that sets a password hash, clears the lock and the failure count, writes the
 * `user.password` row and signs every device out. The two differences are both in the origin:
 * `mustChangePassword` stays false, and the audit payload says `via: 'email-reset'`.
 */
export async function applyChosenPassword(
  store: PasswordResetStore,
  target: { id: string; username: string },
  newPassword: string,
): Promise<{ sessionsDeleted: number }> {
  const passwordHash = await hashPassword(newPassword)
  await store.apply({ userId: target.id, username: target.username, passwordHash, origin: { by: 'email' } })
  // After the transaction, for the same reason `resetPassword` does it there: a failed session
  // delete must not roll back a password the person has already typed twice.
  const sessionsDeleted = await store.deleteSessions(target.id)
  return { sessionsDeleted }
}

/**
 * The real store. `client` is the app's shared handle in the app, and the script's own client
 * (built on the owner URL passed to `docker exec`) on the host.
 */
export function prismaPasswordResetStore(
  ctx: AuditContext,
  client: PrismaClient = prisma,
): PasswordResetStore {
  return {
    async apply({ userId, username, passwordHash, origin }) {
      await client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          // Phase 12 (P12): a reset hands out another temporary password, so the flag goes back
          // on. Phase 16: unless the user chose the password themselves off an emailed link.
          data: {
            passwordHash,
            failedLogins: 0,
            lockedUntil: null,
            mustChangePassword: mustChangeAfterReset(origin),
          },
        })
        await audit(
          {
            action: 'user.password',
            entity: 'User',
            entityId: userId,
            after: resetAuditAfter(username, origin),
          },
          ctx,
          tx,
        )
      })
    },
    async deleteSessions(userId) {
      const result = await client.session.deleteMany({ where: { userId } })
      return result.count
    },
  }
}
