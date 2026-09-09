import type { Metadata } from 'next'
import { requireUser } from '@/src/lib/auth/session'
import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = { title: 'Account · ER Navigator' }

export default async function AccountPage() {
  const user = await requireUser()

  // The shell no longer pads its <main>, because the board's rows are full-bleed; every other
  // page in the group brings its own padding.
  return (
    <div className="px-4 pt-6 pb-6">
      <h2 className="text-title">Your account</h2>
      <dl className="mt-3 divide-y divide-line-soft border-y border-line-soft">
        <div className="flex min-h-11 items-center justify-between gap-3 py-2">
          <dt className="text-label font-medium text-muted">Username</dt>
          <dd className="num text-body font-semibold">{user.username}</dd>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 py-2">
          <dt className="text-label font-medium text-muted">Display name</dt>
          <dd className="text-body font-semibold">{user.displayName}</dd>
        </div>
      </dl>

      <h2 className="mt-8 text-section">Change password</h2>
      <p className="mt-1 text-caption text-muted">
        Changing it signs out every other device you are signed in on.
      </p>
      <ChangePasswordForm />
    </div>
  )
}
