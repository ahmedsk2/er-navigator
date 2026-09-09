'use client'

import { useActionState } from 'react'
import { NEW_PASSWORD_MIN } from '@/src/lib/auth/password'
import { changeMyPassword, type ChangePasswordState } from './actions'

const EMPTY: ChangePasswordState = {}

const FIELD =
  'min-h-11 rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft'

function message(state: ChangePasswordState): string | null {
  switch (state.error) {
    case 'invalid_current':
      return 'That is not your current password.'
    case 'missing_current':
      return 'Enter your current password.'
    case 'too_short':
      return `Use at least ${NEW_PASSWORD_MIN} characters for the new password.`
    case 'mismatch':
      return 'The two new passwords do not match.'
    case 'same_password':
      return 'The new password must be different from the current one.'
    case 'unauthenticated':
      return 'Your session ended. Sign in again.'
    default:
      return null
  }
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeMyPassword, EMPTY)
  const error = message(state)

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="currentPassword" className="text-label font-medium text-muted">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-label font-medium text-muted">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          maxLength={256}
          className={FIELD}
        />
        <p className="text-caption text-muted">At least {NEW_PASSWORD_MIN} characters.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className="text-label font-medium text-muted">
          New password again
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          maxLength={256}
          className={FIELD}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-field border border-line bg-panel px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-field border border-line bg-panel px-3 py-2 text-body text-accent-ink">
          Password changed. Your other devices have been signed out.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-button bg-accent px-4 text-body font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}
