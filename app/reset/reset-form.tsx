'use client'

import { useActionState } from 'react'
import { NEW_PASSWORD_MIN } from '@/src/lib/auth/password'
import { completeReset, type ResetState } from './actions'

const EMPTY: ResetState = {}

const FIELD =
  'min-h-11 w-full rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft'

/**
 * The two fields and the one message (Phase 16). `deadMessage` is a prop for the same reason the
 * sentence on /forgot is: the constant lives beside the rule, in a module that reaches Prisma.
 */
function message(state: ResetState, deadMessage: string): string | null {
  switch (state.error) {
    case 'invalid':
      return deadMessage
    case 'too_short':
      return `Use at least ${NEW_PASSWORD_MIN} characters for the new password.`
    case 'mismatch':
      return 'The two new passwords do not match.'
    case 'rate_limited':
      return 'Too many attempts from this device. Wait a minute and try again.'
    default:
      return null
  }
}

export function ResetForm({ token, deadMessage }: { token: string; deadMessage: string }) {
  const [state, formAction, pending] = useActionState(completeReset, EMPTY)
  const error = message(state, deadMessage)

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
      {/* The token travels in the form rather than only in the URL, so the POST carries it
          whatever the browser did with the address bar. It is checked server-side either way. */}
      <input type="hidden" name="token" value={token} />

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
        <p
          role="alert"
          data-reset-error
          className="rounded-field border border-danger/30 bg-bg px-3 py-2 text-body text-danger"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-button bg-accent px-4 text-body font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set the new password'}
      </button>
    </form>
  )
}
