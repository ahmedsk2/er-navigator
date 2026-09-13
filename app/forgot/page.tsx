import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicAuthCard } from '@/src/components/auth/PublicAuthCard'
import { RESET_REQUESTED_MESSAGE } from '@/src/lib/auth/forgot-password'
import { ForgotForm } from './forgot-form'

export const metadata: Metadata = { title: 'Forgot your password? · ER Navigator' }

/**
 * This page reads nothing per request, so Next would prerender it at build time — and the root
 * layout's instance banner (Phase 12, D6) is rendered from `INSTANCE_LABEL`, which is unset in
 * the Docker build stage and set on the demo CONTAINER. A static /forgot would therefore be the
 * one page on the demo instance without "DEMO: invented patients only" on it, which is exactly
 * the accident that banner exists to prevent. `/reset` is dynamic already: it reads the query
 * and the headers. `tests/instance/instance.spec.ts` is what proves this.
 */
export const dynamic = 'force-dynamic'

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
        No email on your account? Ask the ER Navigator lead to reset it for you.
      </p>
      <p className="mt-4 text-body">
        <Link href="/login" className="text-accent-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </PublicAuthCard>
  )
}
