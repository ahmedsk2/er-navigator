import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { PublicAuthCard } from '@/src/components/auth/PublicAuthCard'
import { clientIpFrom } from '@/src/lib/audit'
import { resetTokenIsLive, RESET_LINK_DEAD_MESSAGE } from '@/src/lib/auth/forgot-password'
import { prismaCompleteResetStore } from '@/src/lib/auth/forgot-password-store'
import { ResetForm } from './reset-form'

export const metadata: Metadata = { title: 'Set a new password · ER Navigator' }

/**
 * Public (Phase 16, docs/specs/phase16-forgot-password.md, section 5). `proxy.ts` lists it beside
 * /login and /forgot.
 *
 * This page says nothing about the account behind the link: not the username, not the display
 * name, not the address it was sent to. It renders a form, or one sentence and the way back.
 *
 * The GET check is a courtesy, not the gate: a dead link should not ask somebody to type a
 * password twice before telling them. The gate is `completeReset`, which checks the same token
 * against the same rule when the form is posted.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const requestHeaders = await headers()
  const live =
    typeof token === 'string' &&
    token.length > 0 &&
    (await resetTokenIsLive({
      store: prismaCompleteResetStore({
        ip: clientIpFrom(requestHeaders),
        userAgent: requestHeaders.get('user-agent'),
      }),
      token,
    }))

  if (!live) {
    return (
      <PublicAuthCard title="That link has expired">
        <p data-reset-dead role="status" className="mt-6 text-body text-ink-2">
          {RESET_LINK_DEAD_MESSAGE}
        </p>
        <p className="mt-6 text-body">
          <Link href="/forgot" className="underline underline-offset-2">
            Ask for a new link
          </Link>
        </p>
      </PublicAuthCard>
    )
  }

  return (
    <PublicAuthCard title="Set a new password">
      <ResetForm token={token} deadMessage={RESET_LINK_DEAD_MESSAGE} />
      <p className="mt-8 text-caption text-muted">
        Setting it signs you out of every device, including this one, and then you sign in again.
      </p>
    </PublicAuthCard>
  )
}
