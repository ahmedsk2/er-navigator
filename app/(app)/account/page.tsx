import type { Metadata } from 'next'
import { PageHeader } from '@/src/components/shell/PageHeader'
import { requireUser } from '@/src/lib/auth/session'
import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = { title: 'Account · ER Navigator' }

export default async function AccountPage() {
  const user = await requireUser()

  // The shell no longer pads its <main>, because the board's rows are full-bleed; every other
  // page in the group brings its own padding — `PageHeader` for the title, this wrapper for the
  // body, which drops the phone's 16 px inset on a laptop because the content column has its own.
  // Phase 9: the two blocks become cards, so the page reads as two things and not as one long
  // strip of hairlines, and on a laptop they stop at a reading width instead of spanning the
  // column. The headings, the copy and the form are untouched.
  return (
    <div>
      <PageHeader title="Your account" />
      <div className="px-4 pb-6 lg:px-0">
        {/* Phase 12 (P12): the flag on the row is the whole truth, so a hand-typed /account shows
            this too. No dismiss control and no query parameter — until the password is changed,
            `requireUser()` sends every other signed-in page back here. */}
        {user.mustChangePassword ? (
          <p
            role="status"
            data-must-change
            className="mb-4 rounded-card border border-band-h4 border-l-4 border-l-band-h4 bg-panel p-4 text-body text-band-h4-ink shadow-card lg:max-w-[560px]"
          >
            Set your own password before you use the board. The one you were given is temporary.
          </p>
        ) : null}
        <dl className="divide-y divide-line-soft rounded-card border border-line bg-panel px-4 shadow-card lg:max-w-[560px]">
          <div className="flex min-h-11 items-center justify-between gap-3 py-2.5">
            <dt className="text-label font-medium text-muted">Username</dt>
            <dd className="num text-body font-semibold">{user.username}</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 py-2.5">
            <dt className="text-label font-medium text-muted">Display name</dt>
            <dd className="text-body font-semibold">{user.displayName}</dd>
          </div>
        </dl>

        <section className="mt-6 rounded-card border border-line bg-panel p-4 shadow-card lg:max-w-[560px]">
          <h2 className="text-section">Change password</h2>
          <p className="mt-1 text-caption text-muted">
            Changing it signs out every other device you are signed in on.
          </p>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  )
}
