/**
 * The database half of Phase 16 (docs/specs/phase16-forgot-password.md): the one implementation
 * of the two ports in `forgot-password.ts`.
 *
 * Kept apart from that file for the reason `alerts/store.ts` is kept apart from `alerts/cycle.ts`:
 * the rule is asserted against fakes in the unit suite, and this is asserted against a real
 * Postgres in `tests/db/forgot-password.test.ts`.
 *
 * The app connects as the limited app role, which may INSERT and UPDATE `PasswordResetToken`,
 * INSERT into `Outbox` (DELETE is revoked) and INSERT into `AuditLog` — and delete none of them.
 */
import { audit, type AuditContext } from '@/src/lib/audit'
import { prisma } from '@/src/lib/db'
import type { CompleteResetStore, ForgotPasswordStore, ResetTokenLookup } from './forgot-password'
import { RESET_REQUESTED_AUDIT_AFTER } from './forgot-password'
import { prismaPasswordResetStore, type PasswordResetStore } from './password-reset'

export type PrismaLike = typeof prisma

/**
 * `ctx.actorId` is null here and that is deliberate: `/forgot` is a public form, so the person who
 * typed the username is not known to be the account holder. The target is on the row's `entityId`.
 */
export function prismaForgotPasswordStore(
  ctx: AuditContext,
  client: PrismaLike = prisma,
): ForgotPasswordStore {
  return {
    async findTarget(username) {
      const row = await client.user.findUnique({
        where: { username },
        select: { id: true, email: true, active: true },
      })
      // Three refusals, one answer: no such user, deactivated, or no address on file. The caller
      // cannot tell them apart and neither can the page.
      if (!row || !row.active || !row.email) return null
      return { id: row.id, email: row.email }
    },

    async countRequestsSince(userId, since) {
      return client.passwordResetToken.count({ where: { userId, createdAt: { gte: since } } })
    },

    async issue(input) {
      await client.$transaction(async (tx) => {
        // Every earlier link of this account dies here, so a person who asks twice can only use
        // the second one. `usedAt` means "cannot be used again", spent or superseded.
        await tx.passwordResetToken.updateMany({
          where: { userId: input.userId, usedAt: null },
          data: { usedAt: input.now },
        })
        await tx.passwordResetToken.create({
          data: {
            userId: input.userId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            requestedIp: input.requestedIp,
          },
        })
        // The raw token lives here, in this row's `text`, and in the person's mailbox. Nowhere
        // else, and never in the audit row below.
        await tx.outbox.create({
          data: { to: input.email, subject: input.subject, text: input.text },
        })
        await audit(
          {
            action: 'auth.reset.requested',
            entity: 'User',
            entityId: input.userId,
            after: { ...RESET_REQUESTED_AUDIT_AFTER },
          },
          ctx,
          tx,
        )
      })
    },
  }
}

/**
 * The other half. `ip` and `userAgent` are the request's; the actor is not known until the token
 * resolves, which is why the password store is a factory — the person who followed the link is
 * the actor on their own `user.password` row.
 */
export function prismaCompleteResetStore(
  request: { ip: string | null; userAgent: string | null },
  client: PrismaLike = prisma,
): CompleteResetStore {
  return {
    async findToken(tokenHash): Promise<ResetTokenLookup | null> {
      return client.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          tokenHash: true,
          expiresAt: true,
          usedAt: true,
          user: { select: { id: true, username: true, active: true } },
        },
      })
    },

    async markTokenUsed(tokenId, at) {
      await client.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt: at } })
    },

    passwordStore(actorId): PasswordResetStore {
      return prismaPasswordResetStore({ actorId, ip: request.ip, userAgent: request.userAgent }, client)
    },
  }
}
