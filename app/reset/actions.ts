'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { auditQuietly, clientIpFrom, contextFrom } from '@/src/lib/audit'
import { completePasswordReset } from '@/src/lib/auth/forgot-password'
import { prismaCompleteResetStore } from '@/src/lib/auth/forgot-password-store'
import { newPasswordSchema } from '@/src/lib/auth/password'
import { passwordResetRateLimiter } from '@/src/lib/auth/rate-limit'

export type ResetErrorCode = 'invalid' | 'too_short' | 'mismatch' | 'rate_limited'

export type ResetState = { error?: ResetErrorCode }

const formSchema = z
  .object({
    token: z.string().min(1).max(256),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'] })

/**
 * Spend a one-time link (Phase 16, docs/specs/phase16-forgot-password.md, section 5).
 *
 * Public: it runs before there is a session, like `login` and `requestReset`, so there is no
 * permission to check. `tests/unit/server-actions.test.ts` lists it as an exemption by name.
 *
 * `invalid` is one outcome covering a token that is missing, already spent, expired or belonging
 * to an account that has since been deactivated. "That link has already been used" and "there is
 * no such link" are two different facts about somebody else's account, so the page says neither.
 * The two messages that do differ, `too_short` and `mismatch`, are about what was typed into this
 * browser and reveal nothing.
 */
export async function completeReset(_previous: ResetState, formData: FormData): Promise<ResetState> {
  const requestHeaders = await headers()
  const ip = clientIpFrom(requestHeaders)
  if (!passwordResetRateLimiter.check(ip ?? 'unknown').allowed) return { error: 'rate_limited' }

  const parsed = formSchema.safeParse({
    token: formData.get('token'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    const paths = new Set(parsed.error.issues.map((i) => i.path[0]))
    if (paths.has('token')) return { error: 'invalid' }
    if (paths.has('newPassword')) return { error: 'too_short' }
    return { error: 'mismatch' }
  }

  const outcome = await completePasswordReset({
    store: prismaCompleteResetStore({ ip, userAgent: requestHeaders.get('user-agent') }),
    token: parsed.data.token,
    newPassword: parsed.data.newPassword,
  })

  if (!outcome.ok) {
    // On the record, and MRN-free, token-free and username-free: the failure is about a string
    // somebody pasted, and this row is what a repeated one would show up in.
    await auditQuietly(
      { action: 'auth.fail', entity: 'User', entityId: null, after: { reason: 'reset_token_invalid' } },
      contextFrom(requestHeaders, null),
    )
    return { error: 'invalid' }
  }

  // No session is created here on purpose: every session of that account was just deleted, and
  // the person proves the new password by typing it once on the form they know.
  redirect('/login?reset=1')
}
