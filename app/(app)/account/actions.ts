'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { clientIpFrom } from '@/src/lib/audit'
import { changePassword } from '@/src/lib/auth/account'
import { loginPasswordSchema, newPasswordSchema } from '@/src/lib/auth/password'
import { getSession, setSessionCookie } from '@/src/lib/auth/session'

export type ChangePasswordErrorCode =
  | 'invalid_current'
  | 'too_short'
  | 'mismatch'
  | 'same_password'
  | 'missing_current'
  | 'unauthenticated'

export type ChangePasswordState = { ok?: true; error?: ChangePasswordErrorCode }

const formSchema = z
  .object({
    currentPassword: loginPasswordSchema,
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'] })

export async function changeMyPassword(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const current = await getSession()
  if (!current) return { error: 'unauthenticated' }

  const raw = {
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  }
  const parsed = formSchema.safeParse(raw)
  if (!parsed.success) {
    const paths = new Set(parsed.error.issues.map((i) => i.path[0]))
    if (paths.has('currentPassword')) return { error: 'missing_current' }
    if (paths.has('newPassword')) return { error: 'too_short' }
    return { error: 'mismatch' }
  }

  const requestHeaders = await headers()
  const outcome = await changePassword({
    userId: current.user.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
    ip: clientIpFrom(requestHeaders),
    userAgent: requestHeaders.get('user-agent'),
  })

  if (!outcome.ok) {
    return { error: outcome.error === 'not_found' ? 'unauthenticated' : outcome.error }
  }

  // Every session was deleted, including this one; take the replacement. The new cookie is a
  // session cookie: "remember this device" is not re-asked here, and the server-side expiry is
  // still 12 h, so the worst case is one extra sign-in on a remembered phone.
  await setSessionCookie(outcome.token, false)
  return { ok: true }
}
