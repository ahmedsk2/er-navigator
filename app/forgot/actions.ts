'use server'

import { headers } from 'next/headers'
import { clientIpFrom, contextFrom } from '@/src/lib/audit'
import { withConstantTimeFloor } from '@/src/lib/auth/constant-time'
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
 * username or address, a deactivated account, an account with no address, one address on two
 * accounts, a fourth request within the hour, a refused rate limit and a link genuinely on its
 * way are one answer. Any difference between them is a way to ask this application whether a
 * member of staff exists.
 *
 * P16.41: including a difference on the clock. The whole body runs inside `withConstantTimeFloor`,
 * so every one of those outcomes takes at least `RESET_RESPONSE_FLOOR_MS` measured from entry.
 * Before it, a miss answered in about 1 ms and a hit in about 10 because only the hit pays for a
 * transaction, which the security review read straight off the wire as p50 13.7 ms against 22.8.
 */
export async function requestReset(_previous: ForgotState, formData: FormData): Promise<ForgotState> {
  return withConstantTimeFloor(async () => {
    const requestHeaders = await headers()
    const ip = clientIpFrom(requestHeaders)

    // Five a minute per client IP, the sign-in numbers in their own bucket (rate-limit.ts). A
    // refusal is answered exactly like everything else, and now takes exactly as long.
    if (!passwordResetRateLimiter.check(ip ?? 'unknown').allowed) return { sent: true }

    // A username or the email address on the account (P16.42); the rule decides which.
    const identifier = formData.get('identifier')
    await requestPasswordReset(typeof identifier === 'string' ? identifier : '', ip, {
      store: prismaForgotPasswordStore(contextFrom(requestHeaders, null)),
      appUrl: appUrl(),
    })
    return { sent: true }
  })
}
