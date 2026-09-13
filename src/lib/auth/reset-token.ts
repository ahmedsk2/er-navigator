/**
 * The one-time password-reset token (Phase 16, docs/specs/phase16-forgot-password.md).
 *
 * The same construction `session.ts` uses for the session cookie, and for the same reason: the
 * link carries 32 random bytes, the row carries only sha256 of them, so a database leak cannot be
 * replayed as a reset. The raw token exists in the email and in the person's browser and nowhere
 * else — not in a column, not in a log line, not in an audit payload.
 *
 * Pure, and free of Prisma and of `next/headers`, so the whole rule is asserted in the unit suite
 * (`__tests__/reset-token.test.ts`) and the module can be reached from a server action, from a
 * page and from a plain-Node bundle alike.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 bytes, the same as a session token. 43 characters of base64url, unpadded. */
export const RESET_TOKEN_BYTES = 32

/** Ahmed's number, and what the page and the email both say out loud. */
export const RESET_TOKEN_TTL_MINUTES = 30
export const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60_000

/**
 * At most three links an hour for one account. A fourth request is answered with the same
 * sentence as every other outcome and writes nothing: somebody hammering the form must not be
 * able to fill a mailbox, and must not be able to tell that they are being ignored.
 */
export const RESET_REQUESTS_PER_HOUR = 3
export const RESET_REQUEST_WINDOW_MS = 60 * 60_000

/** base64url so the token drops straight into a query string with nothing to escape. */
export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('base64url')
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function resetTokenExpiry(now: Date): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS)
}

/** The oldest request that still counts against `RESET_REQUESTS_PER_HOUR`. */
export function resetRequestWindowStart(now: Date): Date {
  return new Date(now.getTime() - RESET_REQUEST_WINDOW_MS)
}

/** As much of the row as the decision needs. Deliberately not the Prisma model. */
export type ResetTokenRow = {
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
}

/**
 * May this presented token be spent?
 *
 * Three conditions, and no way for the caller to learn which one failed: a missing row, a used
 * row and an expired row all answer false, because "that link has already been used" and "there
 * is no such link" are two different facts about somebody else's account.
 *
 * The digest compare is `timingSafeEqual`. The lookup is by an indexed hash of 32 random bytes so
 * this is belt and braces, but a token check that is not constant time is the kind of thing that
 * gets copied into a place where it matters. A digest of the wrong length is refused rather than
 * thrown on: `timingSafeEqual` requires equal-sized buffers.
 */
export function resetTokenUsable(
  row: ResetTokenRow | null | undefined,
  presentedHash: string,
  now: Date,
): boolean {
  if (!row) return false
  const stored = Buffer.from(row.tokenHash, 'utf8')
  const presented = Buffer.from(presentedHash, 'utf8')
  if (stored.length !== presented.length) return false
  if (!timingSafeEqual(stored, presented)) return false
  if (row.usedAt !== null) return false
  return row.expiresAt.getTime() > now.getTime()
}
