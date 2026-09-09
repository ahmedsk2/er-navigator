/**
 * Passwords: hashing, verification and the zod shapes the login and change-password forms parse.
 *
 * bcryptjs at cost 12 — the same cost prisma/seed.ts uses for the first ADMIN, so a seeded
 * account and one created later verify identically. Nothing here logs, returns or embeds a
 * plaintext password, and no caller ever sees a hash (see the `select` lists in session.ts).
 */
import bcrypt from 'bcryptjs'
import { z } from 'zod'

export const BCRYPT_COST = 12

/**
 * A real cost-12 hash of a passphrase nobody holds. When the username is unknown the login path
 * still runs one bcrypt comparison against this value, so "no such user" and "wrong password"
 * take the same time on the wire and the login form cannot be used to enumerate staff usernames.
 * Regenerate with: node -e "console.log(require('bcryptjs').hashSync('anything', 12))".
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$N3EkDnGSy2aXaM1D9De7f.JKFdZo0BrGL95vTD6OPphoC8a0NMq0C'

/** Injected in tests; production always uses bcrypt. */
export type Comparator = (plain: string, hash: string) => Promise<boolean>

const bcryptCompare: Comparator = (plain, hash) => bcrypt.compare(plain, hash)

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Verify a password against a hash. `hash` is null when the username does not exist: the
 * comparison still runs, against DUMMY_PASSWORD_HASH, and the answer is always false.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
  compare: Comparator = bcryptCompare,
): Promise<boolean> {
  const matched = await compare(plain, hash ?? DUMMY_PASSWORD_HASH)
  return hash ? matched : false
}

// Login: the password is whatever the user already has, so it is only bounded, never judged.
export const loginUsernameSchema = z.string().trim().min(1).max(64)
export const loginPasswordSchema = z.string().min(1).max(256)

export const loginSchema = z.object({
  username: loginUsernameSchema,
  password: loginPasswordSchema,
  remember: z.boolean(),
})
export type LoginInput = z.infer<typeof loginSchema>

// Change password: this is where a minimum length is enforced (spec section 5).
export const NEW_PASSWORD_MIN = 12
export const newPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_MIN, `Use at least ${NEW_PASSWORD_MIN} characters.`)
  .max(256)
