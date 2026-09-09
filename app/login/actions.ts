'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clientIpFrom, contextFrom } from '@/src/lib/audit'
import { attemptLogin, auditRateLimited } from '@/src/lib/auth/login'
import { safeNextPath } from '@/src/lib/auth/next-path'
import { loginSchema } from '@/src/lib/auth/password'
import { loginRateLimiter } from '@/src/lib/auth/rate-limit'
import { deleteSessionByToken, readSessionCookie, setSessionCookie } from '@/src/lib/auth/session'

export type LoginErrorCode = 'invalid' | 'locked' | 'rate_limited' | 'invalid_input'

export type LoginState = {
  error?: LoginErrorCode
  /** Only set with `locked`, so the form can say how long the wait is. */
  lockedMinutes?: number
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
    return outcome.error === 'locked'
      ? { error: 'locked', lockedMinutes: outcome.lockedMinutes }
      : { error: outcome.error }
  }

  await setSessionCookie(outcome.token, parsed.data.remember)
  // Resolved, not pattern-matched: see src/lib/auth/next-path.ts for why.
  redirect(safeNextPath(formData.get('next')))
}
