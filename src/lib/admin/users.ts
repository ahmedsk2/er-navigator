/**
 * Admin → Users. Create, change role, set or clear the work email, deactivate/reactivate, reset
 * password.
 *
 * The email is the alerts worker's whole directory (Phase 7): an active SUPERVISOR or ADMIN with
 * an address here gets the 6 h+ threshold mail, and nobody else does. It is staff contact data,
 * never a patient's — the PHI rule (locked plan section 3) is about the Case model.
 *
 * Nothing is deleted here and nothing ever will be: a person who leaves is deactivated, which
 * keeps their name on the cases and updates they wrote (locked plan section 9, and the app DB
 * role has DELETE on User revoked anyway).
 *
 * Three rules the spec states and this file enforces server-side, not in the screen:
 *  - a user cannot deactivate or demote themselves (an administrator locking themselves out of
 *    the only admin account is a support call, not a feature);
 *  - deactivating someone, and resetting their password, deletes their sessions, so the phone on
 *    the ward desk stops working immediately rather than at the end of its twelve hours;
 *  - the `system` account cannot be changed at all.
 *
 * Every change writes `user.create`, `user.update` or `user.password` with before/after. A
 * temporary password is returned once, to be read out and typed in; it is never stored in plain
 * text, never logged and never audited.
 */
import { randomInt } from 'node:crypto'
import type { Role } from '@prisma/client'
import { z } from 'zod'
import { audit, type AuditContext } from '@/src/lib/audit'
import { hashPassword } from '@/src/lib/auth/password'
import { assertCan, deleteSessionsForUser, type AuthUser } from '@/src/lib/auth/session'
import { isSystemAccount } from '@/src/lib/auth/system-user'
import { prisma } from '@/src/lib/db'
import { fail, type AdminFailure } from './types'
import { EMAIL_MAX, USERNAME_RE, type UserRow } from './user-view'

const usernameSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .refine((v) => USERNAME_RE.test(v), {
    message: 'Use 3 to 32 characters: lower-case letters, digits, dot, dash or underscore.',
  })

const roleSchema = z.enum(['NAVIGATOR', 'SUPERVISOR', 'ADMIN', 'VIEWER'])

const EMAIL_MESSAGE = 'Enter a work email address, or leave it blank.'

/**
 * The staff work address (Phase 7). Optional everywhere: an empty box means "no address", and it
 * is stored as NULL rather than as an empty string, because the column is unique and two blanks
 * would collide. Trimmed and lower-cased first, so `Sami@X.org` and `sami@x.org` cannot both
 * exist. `z.email()` is zod 4's spelling of `z.string().email()`; the check is the same one.
 */
export const emailSchema = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v == null ? '' : v),
    z.union([z.literal(''), z.email(EMAIL_MESSAGE).max(EMAIL_MAX, EMAIL_MESSAGE)]),
  )
  .transform((v) => (v === '' ? null : v))

const createSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(2, 'Enter the name as it should appear.').max(80),
  role: roleSchema,
  email: emailSchema,
})

// No i, l, o, 0 or 1: this is read out loud across a ward desk before it is typed in.
const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const TEMPORARY_PASSWORD_LENGTH = 16

export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]
  return out
}

export async function loadUsers(): Promise<UserRow[]> {
  const rows = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { username: 'asc' }],
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      active: true,
      email: true,
      lastLoginAt: true,
      createdAt: true,
    },
  })
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    active: row.active,
    email: row.email,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isSystem: isSystemAccount(row.username),
  }))
}

export type CreateUserResult =
  | { ok: true; id: string; username: string; temporaryPassword: string }
  | AdminFailure

export async function createUser(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<CreateUserResult> {
  await assertCan(actor, 'admin.users', ctx)
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return fail('validation', parsed.error.issues[0]?.message ?? 'Check the details and try again.')
  }
  const { username, displayName, role, email } = parsed.data
  if (isSystemAccount(username)) {
    return fail('system', 'That username is reserved for the automatic system account.')
  }

  const clash = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (clash) return fail('duplicate', `The username "${username}" is already taken.`)
  if (email) {
    const emailClash = await prisma.user.findUnique({ where: { email }, select: { username: true } })
    if (emailClash) return fail('duplicate', `${email} is already on "${emailClash.username}".`)
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.user.create({
      data: { username, displayName, role, email, passwordHash, active: true },
      select: { id: true },
    })
    await audit(
      {
        action: 'user.create',
        entity: 'User',
        entityId: row.id,
        after: { username, displayName, role, active: true, email },
      },
      ctx,
      tx,
    )
    return row
  })

  return { ok: true, id: created.id, username, temporaryPassword }
}

type Target = {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  email: string | null
}

async function loadTarget(userId: string): Promise<Target | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, role: true, active: true, email: true },
  })
}

export type UpdateUserResult = { ok: true; sessionsDeleted: number } | AdminFailure

export async function setUserActive(
  actor: AuthUser,
  userId: string,
  active: boolean,
  ctx: AuditContext,
): Promise<UpdateUserResult> {
  await assertCan(actor, 'admin.users', ctx)
  const target = await loadTarget(userId)
  if (!target) return fail('missing', 'That user no longer exists.')
  if (isSystemAccount(target.username)) {
    return fail('system', 'The system account cannot be changed. It is never able to sign in.')
  }
  if (target.id === actor.id && !active) {
    return fail('self', 'You cannot deactivate your own account. Ask another administrator.')
  }
  if (target.active === active) return { ok: true, sessionsDeleted: 0 }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { active } })
    await audit(
      {
        action: 'user.update',
        entity: 'User',
        entityId: userId,
        before: { username: target.username, active: target.active },
        after: { username: target.username, active },
      },
      ctx,
      tx,
    )
  })

  // Deactivation ends every session now; `resolveSessionToken` would also refuse them on the
  // next request, but a signed-in phone must stop working the moment the box is unticked.
  const sessionsDeleted = active ? 0 : await deleteSessionsForUser(userId)
  return { ok: true, sessionsDeleted }
}

export async function setUserRole(
  actor: AuthUser,
  userId: string,
  role: unknown,
  ctx: AuditContext,
): Promise<UpdateUserResult> {
  await assertCan(actor, 'admin.users', ctx)
  const parsed = roleSchema.safeParse(role)
  if (!parsed.success) return fail('validation', 'That is not a role.')
  const target = await loadTarget(userId)
  if (!target) return fail('missing', 'That user no longer exists.')
  if (isSystemAccount(target.username)) {
    return fail('system', 'The system account cannot be changed. It is never able to sign in.')
  }
  if (target.id === actor.id && parsed.data !== target.role) {
    return fail('self', 'You cannot change your own role. Ask another administrator.')
  }
  if (target.role === parsed.data) return { ok: true, sessionsDeleted: 0 }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role: parsed.data } })
    await audit(
      {
        action: 'user.update',
        entity: 'User',
        entityId: userId,
        before: { username: target.username, role: target.role },
        after: { username: target.username, role: parsed.data },
      },
      ctx,
      tx,
    )
  })
  return { ok: true, sessionsDeleted: 0 }
}

/**
 * Set or clear the staff work address. An empty string clears it (stored as NULL), which is how
 * someone is taken off the alert list without deactivating their account.
 *
 * Changing an address does not touch sessions: it is contact data, not a credential. The audit
 * row carries both the old and the new value, because "who was on the alert list on the night of
 * the twelfth" is exactly the kind of question the audit log exists to answer.
 */
export async function setUserEmail(
  actor: AuthUser,
  userId: string,
  email: unknown,
  ctx: AuditContext,
): Promise<UpdateUserResult> {
  await assertCan(actor, 'admin.users', ctx)
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) {
    return fail('validation', parsed.error.issues[0]?.message ?? 'Check the address and try again.')
  }
  const next = parsed.data
  const target = await loadTarget(userId)
  if (!target) return fail('missing', 'That user no longer exists.')
  if (isSystemAccount(target.username)) {
    return fail('system', 'The system account cannot be changed. It is never able to sign in.')
  }
  if (target.email === next) return { ok: true, sessionsDeleted: 0 }
  if (next) {
    const clash = await prisma.user.findUnique({ where: { email: next }, select: { username: true } })
    if (clash) return fail('duplicate', `${next} is already on "${clash.username}".`)
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { email: next } })
    await audit(
      {
        action: 'user.update',
        entity: 'User',
        entityId: userId,
        before: { username: target.username, email: target.email },
        after: { username: target.username, email: next },
      },
      ctx,
      tx,
    )
  })
  return { ok: true, sessionsDeleted: 0 }
}

export type ResetPasswordResult =
  | { ok: true; username: string; temporaryPassword: string; sessionsDeleted: number }
  | AdminFailure

export async function resetUserPassword(
  actor: AuthUser,
  userId: string,
  ctx: AuditContext,
): Promise<ResetPasswordResult> {
  await assertCan(actor, 'admin.users', ctx)
  const target = await loadTarget(userId)
  if (!target) return fail('missing', 'That user no longer exists.')
  if (isSystemAccount(target.username)) {
    return fail('system', 'The system account has no password to reset.')
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    })
    await audit(
      {
        action: 'user.password',
        entity: 'User',
        entityId: userId,
        after: { username: target.username, self: false, byAdmin: actor.username },
      },
      ctx,
      tx,
    )
  })

  const sessionsDeleted = await deleteSessionsForUser(userId)
  return { ok: true, username: target.username, temporaryPassword, sessionsDeleted }
}
