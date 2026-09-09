'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const EMPTY: LoginState = {}

/**
 * One message for "wrong password", "no such user" and "deactivated" — the form must not tell
 * an attacker which usernames exist. Locked is separate because the user needs to know waiting
 * is the answer.
 */
function message(state: LoginState): string | null {
  switch (state.error) {
    case 'invalid':
      return 'Wrong username or password.'
    case 'locked': {
      const n = state.lockedMinutes ?? 15
      return `Too many attempts. Try again in ${n} ${n === 1 ? 'minute' : 'minutes'}.`
    }
    case 'rate_limited':
      return 'Too many attempts from this device. Wait a minute and try again.'
    case 'invalid_input':
      return 'Enter your username and password.'
    default:
      return null
  }
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, EMPTY)
  const error = message(state)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1">
        <label htmlFor="username" className="text-label font-medium text-muted">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={64}
          className="min-h-11 rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-label font-medium text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className="min-h-11 rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <label htmlFor="remember" className="flex min-h-11 items-center gap-3 text-body text-ink-2">
        <input
          id="remember"
          name="remember"
          type="checkbox"
          className="size-5 rounded-sm border-line accent-accent"
        />
        Remember this device
      </label>

      {error ? (
        <p role="alert" className="rounded-field border border-line bg-panel px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-button bg-accent px-4 text-body font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
