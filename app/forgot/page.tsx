import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicAuthCard } from '@/src/components/auth/PublicAuthCard'
import { RESET_REQUESTED_MESSAGE } from '@/src/lib/auth/forgot-password'
import { ForgotForm } from './forgot-form'

export const metadata: Metadata = { title: 'Forgot your password? · ER Navigator' }

/**
 * Public (Phase 16, docs/specs/phase16-forgot-password.md). `proxy.ts` lists it beside /login, and
 * it checks everything itself — which here means checking nothing about the caller and everything
 * about the answer: one sentence, whatever the server decided.
 */
export default function ForgotPage() {
  return (
    <PublicAuthCard title="Forgot your password?">
      <ForgotForm message={RESET_REQUESTED_MESSAGE} />
      <p className="mt-8 text-caption text-muted">
        <Link href="/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
      <p className="mt-2 text-caption text-muted">
        No email on your account? Ask the ER Navigator lead to reset it for you.
      </p>
    </PublicAuthCard>
  )
}
