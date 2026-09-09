import type { Metadata } from 'next'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · ER Navigator' }

// The gate (proxy.ts) sends a refused request here with ?next=<path>; the action validates it.
// `?expired=1` comes from `requireUser()` when the cookie outlived its session — the gate clears
// the cookie on the way in, and this page says what happened rather than showing a bare form.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>
}) {
  const { next, expired } = await searchParams

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="text-label font-medium text-muted">Qatif Central Hospital · Emergency Department</p>
      <h1 className="mt-1 text-title tracking-tight">ER Navigator</h1>
      {expired ? (
        <p
          role="status"
          data-session-ended
          className="mt-4 rounded-field border border-line bg-panel px-3 py-2 text-body text-ink-2"
        >
          Your session has ended. Sign in again.
        </p>
      ) : null}
      <LoginForm next={typeof next === 'string' ? next : '/'} />
      <p className="mt-8 text-caption text-muted">
        Hospital accounts only. Ask the ER Navigator lead for access.
      </p>
    </main>
  )
}
