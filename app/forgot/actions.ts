'use server'

import { headers } from 'next/headers'
import { clientIpFrom, contextFrom } from '@/src/lib/audit'
import { requestPasswordReset } from '@/src/lib/auth/forgot-password'
import { prismaForgotPasswordStore } from '@/src/lib/auth/forgot-password-store'
import { passwordResetRateLimiter } from '@/src/lib/auth/rate-limit'
import { appUrl } from '@/src/lib/instance'

export type ForgotState = { sent?: true }

/**
 * "Forgot your password?" (Phase 16, docs/specs/phase16-forgot-password.md, section 4).
 *
 * Public: it runs before there is a session, like `login`, so there is no permission to check and
 * no actor to check it for. `tests/unit/server-actions.test.ts` lists it as an exemption by name.
 *
 * It answers `RESET_REQUESTED_MESSAGE` and nothing else, on every path through it: an unknown
 * username, a deactivated account, an account with no address, a fourth request within the hour,
 * a refused rate limit and a link genuinely on its way are one answer. Any difference between
 * them is a way to ask this application whether a member of staff exists.
 */
export async function requestReset(_previous: ForgotState, formData: FormData): Promise<ForgotState> {
  const requestHeaders = await headers()
  const ip = clientIpFrom(requestHeaders)

  // Five a minute per client IP, the sign-in numbers in their own bucket (rate-limit.ts). A
  // refusal is answered exactly like everything else.
  if (!passwordResetRateLimiter.check(ip ?? 'unknown').allowed) return { sent: true }

  const username = formData.get('username')
  await requestPasswordReset(typeof username === 'string' ? username : '', ip, {
    store: prismaForgotPasswordStore(contextFrom(requestHeaders, null)),
    appUrl: appUrl(),
  })
  return { sent: true }
}
