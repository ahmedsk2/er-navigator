/**
 * Sessions: opaque cookies, server-side state, no auth library and no JWT (locked plan section 7).
 *
 * The cookie carries 32 random bytes as base64url. The database stores only sha256 of that
 * value, so a leaked Session table cannot be replayed as a login. Twelve-hour sliding expiry,
 * rotated on login and on password change, deleted on logout and when a user is deactivated.
 *
 * Everything above `--- request-bound ---` is pure or plain Prisma and is unit- and
 * database-tested; below it are the helpers that need the Next request (cookies, headers).
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Prisma, Role, Shift } from '@prisma/client'
import { cookies, headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import { cache } from 'react'
import { auditQuietly, contextFrom, type AuditContext } from '@/src/lib/audit'
import { can, type Action } from '@/src/lib/authz/policy'
import { prisma } from '@/src/lib/db'

export const SESSION_COOKIE = 'ern_session'
/**
 * Set alongside the session cookie when "Remember this device" was ticked. It carries no secret
 * (value "1"); the route gate uses its presence to re-stamp both cookies' 12 h lifetime on every
 * request, which is what makes the browser-side expiry slide like the server-side one.
 */
export const REMEMBER_COOKIE = 'ern_remember'
export const TOKEN_BYTES = 32
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
/** A session's lastSeenAt/expiresAt are refreshed at most this often: one UPDATE per five minutes. */
export const SLIDING_REFRESH_MS = 5 * 60 * 1000

/** The user as the app sees it. `passwordHash` is deliberately absent from the type and the query. */
export type AuthUser = {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  lastShift: Shift | null
}

export type CurrentSession = {
  user: AuthUser
  session: { id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date }
}

/** The columns of User that may leave the database. Never add passwordHash to this. */
export const AUTH_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  active: true,
  lastShift: true,
} as const satisfies Prisma.UserSelect

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  readonly action: Action
  constructor(action: Action) {
    super(`forbidden: ${action}`)
    this.name = 'ForbiddenError'
    this.action = action
  }
}

export function isForbiddenError(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError
}

// --- pure ---------------------------------------------------------------------------------

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS)
}

export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime()
}

export function needsSlidingRefresh(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SLIDING_REFRESH_MS
}

export type SessionCookieOptions = {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge?: number
}

/**
 * "Remember this device" is the only difference: it gives the cookie a 12 h lifetime, otherwise
 * the browser drops it when it closes. The server-side expiry is 12 h either way and slides in
 * resolveSessionToken(); for remembered devices the route gate (proxy.ts) re-stamps the cookie
 * lifetime on every request, so the browser-side expiry slides too.
 */
export function sessionCookieOptions(remember: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: Math.floor(SESSION_TTL_MS / 1000) } : {}),
  }
}

// --- database -----------------------------------------------------------------------------

export type CreatedSession = { token: string; sessionId: string; expiresAt: Date }

export async function createSession(input: {
  userId: string
  ip: string | null
  userAgent: string | null
  now?: Date
}): Promise<CreatedSession> {
  const now = input.now ?? new Date()
  const token = generateSessionToken()
  const expiresAt = sessionExpiry(now)
  const row = await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: input.userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
    },
    select: { id: true },
  })
  return { token, sessionId: row.id, expiresAt }
}

/** Logout, and the rotation half of login: the presented cookie stops working immediately. */
export async function deleteSessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } })
}

/** Password change and deactivation. Pass `exceptSessionId` to keep the caller signed in. */
export async function deleteSessionsForUser(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
  })
  return result.count
}

/**
 * Look a cookie value up. Returns null — and deletes the row — for an expired session or a
 * deactivated user, so deactivating someone ends their sessions on their next request too.
 */
export async function resolveSessionToken(token: string, now = new Date()): Promise<CurrentSession | null> {
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      user: { select: AUTH_USER_SELECT },
    },
  })
  if (!row) return null
  if (isSessionExpired(row.expiresAt, now) || !row.user.active) {
    await prisma.session.deleteMany({ where: { id: row.id } })
    return null
  }
  if (needsSlidingRefresh(row.lastSeenAt, now)) {
    const expiresAt = sessionExpiry(now)
    await prisma.session.updateMany({ where: { id: row.id }, data: { lastSeenAt: now, expiresAt } })
    return {
      user: row.user,
      session: { id: row.id, createdAt: row.createdAt, lastSeenAt: now, expiresAt },
    }
  }
  return {
    user: row.user,
    session: { id: row.id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt },
  }
}

/**
 * The policy half of `requireAction`, without the request plumbing, so it can be tested against
 * a real database. A refusal is an audit row, not just a 403: the plan wants VIEWER attempts on
 * mutations on the record.
 */
export async function assertCan(user: AuthUser, action: Action, ctx: AuditContext): Promise<void> {
  if (can(user.role, action)) return
  await auditQuietly(
    { action: 'auth.forbidden', entity: 'Action', entityId: action, after: { role: user.role } },
    ctx,
  )
  throw new ForbiddenError(action)
}

// --- request-bound ------------------------------------------------------------------------

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function setSessionCookie(token: string, remember: boolean): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, sessionCookieOptions(remember))
  if (remember) store.set(REMEMBER_COOKIE, '1', sessionCookieOptions(true))
  else store.set(REMEMBER_COOKIE, '', { ...sessionCookieOptions(false), maxAge: 0 })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(false), maxAge: 0 })
  store.set(REMEMBER_COOKIE, '', { ...sessionCookieOptions(false), maxAge: 0 })
}

/**
 * The current session, resolved once per request. `React.cache` means a layout, its page and a
 * server action in the same request share one lookup and at most one sliding-refresh UPDATE.
 */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = await readSessionCookie()
  if (!token) return null
  return resolveSessionToken(token)
})

export async function auditContext(actorId: string | null): Promise<AuditContext> {
  return contextFrom(await headers(), actorId)
}

/**
 * Pages, layouts and server actions get a redirect to /login. Route handlers pass
 * `{ as: 'api' }` and get an UnauthorizedError to map to 401, because answering a fetch with a
 * 307 to an HTML login page is worse than answering it with a status.
 */
export async function requireUser(opts: { as?: 'page' | 'api' } = {}): Promise<AuthUser> {
  const current = await getSession()
  if (current) return current.user
  if (opts.as === 'api') throw new UnauthorizedError()
  /**
   * `?expired=1`, not a bare /login: reaching this line means the gate saw a session cookie and
   * let the request through, and the session behind it turned out to be gone — expired, logged
   * out elsewhere, or the user deactivated by an Admin (Phase 6). A render cannot clear a
   * cookie, so the gate clears it when it sees this parameter; without it the gate would send
   * the still-cookied browser straight back here and the two would loop.
   */
  redirect('/login?expired=1')
}

/**
 * requireUser + the permission matrix.
 *
 * A page (the default) gets Next's `forbidden()` after the `auth.forbidden` audit row is
 * written: the response is a real HTTP 403 carrying `app/forbidden.tsx`, not a 200 whose body
 * happens to say no. A refusal a proxy, a log or a monitor can see is worth more than a pretty
 * one, and Phase 7's route audit is what asked for it. `experimental.authInterrupts` in
 * `next.config.ts` is what makes `forbidden()` legal.
 *
 * A route handler passes `{ as: 'api' }` and still gets a ForbiddenError to map to a 403 with a
 * body of its own; server actions do not call this at all — they call `requireUser()` and let
 * the service's `assertCan` decide, so a refused mutation comes back as a result object the
 * screen can render rather than as a thrown navigation.
 */
export async function requireAction(action: Action, opts: { as?: 'page' | 'api' } = {}): Promise<AuthUser> {
  const user = await requireUser(opts)
  if (opts.as === 'api') {
    await assertCan(user, action, await auditContext(user.id))
    return user
  }
  try {
    await assertCan(user, action, await auditContext(user.id))
  } catch (error) {
    if (isForbiddenError(error)) forbidden()
    throw error
  }
  return user
}
