'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clientIpFrom, contextFrom } from '@/src/lib/audit'
import { attemptLogin, auditRateLimited } from '@/src/lib/auth/login'
import { safeNextPath } from '@/src/lib/auth/next-path'
import { loginSchema } from '@/src/lib/auth/password'
import { loginRateLimiter } from '@/src/lib/auth/rate-limit'
import {
  ACCOUNT_PATH,
  deleteSessionByToken,
  readSessionCookie,
  setSessionCookie,
} from '@/src/lib/auth/session'

export type LoginErrorCode = 'invalid' | 'rate_limited' | 'invalid_input'

export type LoginState = {
  error?: LoginErrorCode
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
    remember: formData.get('remember') === 'on',
  })

  const requestHeaders = await headers()
  const ip = clientIpFrom(requestHeaders)
  const userAgent = requestHeaders.get('user-agent')

  if (!parsed.success) return { error: 'invalid_input' }

  // 5 attempts per rolling minute per client IP. A request with no usable IP shares one bucket
  // rather than being let through.
  if (!loginRateLimiter.check(ip ?? 'unknown').allowed) {
    await auditRateLimited(parsed.data.username, contextFrom(requestHeaders, null))
    return { error: 'rate_limited' }
  }

  // Rotation: whatever session cookie was presented stops working, successful login or not.
  const presented = await readSessionCookie()
  if (presented) await deleteSessionByToken(presented)

  const outcome = await attemptLogin({
    username: parsed.data.username,
    password: parsed.data.password,
    ip,
    userAgent,
  })

  if (!outcome.ok) {
    /**
     * P16.44, a Phase 1 defect the Phase 16 security review found. A LOCKED account used to be
     * told so, with the minutes: "Too many attempts. Try again in 15 minutes." Only a real
     * account can be locked, so ten wrong passwords against a name said, deterministically and
     * in a handful of requests, whether that name belongs to a member of staff — undoing the one
     * message every other outcome of this form has shared since Phase 1, and the whole of the
     * discipline Phase 16 was built on.
     *
     * So the lock stays and the lock is silent. `attemptLogin` still refuses the sign-in, still
     * distinguishes the outcomes and still writes the `auth.locked` row an administrator reads;
     * this is where the difference stops, because a difference in the RESPONSE is an oracle
     * whether or not a page renders it. `lockedMinutes` is gone from the state for the same
     * reason. Where a nurse learns that ten wrong passwords costs fifteen minutes is the guide,
     * section 1, which says it.
     */
    return { error: outcome.error === 'locked' ? 'invalid' : outcome.error }
  }

  await setSessionCookie(outcome.token, parsed.data.remember)
  /**
   * Phase 12 item 5 (P12): an account still on the password an Admin read out goes straight to
   * /account, and not through the board.
   *
   * Not only a courtesy. Next renders this action's redirect destination inside this same
   * request, so a `redirect()` out of that render — which is what the board would do for this
   * user — hands the router a payload whose URL and tree disagree, and the browser refetches for
   * ever. Sending them where they are going to end up anyway is what keeps that from happening.
   */
  if (outcome.user.mustChangePassword) redirect(ACCOUNT_PATH)
  // Resolved, not pattern-matched: see src/lib/auth/next-path.ts for why.
  redirect(safeNextPath(formData.get('next')))
}
