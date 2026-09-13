'use client'

import { useActionState } from 'react'
import { requestReset, type ForgotState } from './actions'

const EMPTY: ForgotState = {}

const FIELD =
  'min-h-11 w-full rounded-field border border-line bg-panel px-3 text-input text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft'

/**
 * One field and one sentence (Phase 16, docs/specs/phase16-forgot-password.md).
 *
 * The field takes a USERNAME OR AN EMAIL ADDRESS (P16.42). It took a username only until Ahmed
 * typed his address into it on 13 September and nothing happened — which is the whole failure
 * mode of a page that answers the same sentence whatever it decides, and the reason the label
 * has to say out loud what it will accept.
 *
 * `message` is a prop rather than an import: the constant lives beside the server-side rule, in a
 * module that reaches Prisma, and this is a client component. The two cannot drift — the action
 * that answers is the one that owns the sentence, and `tests/e2e/phase16-forgot-password.spec.ts`
 * reads it off the screen.
 *
 * The form is replaced by the answer rather than joined by it: there is nothing to try again.
 */
export function ForgotForm({ message }: { message: string }) {
  const [state, formAction, pending] = useActionState(requestReset, EMPTY)

  if (state.sent) {
    return (
      <p data-reset-requested role="status" className="mt-6 text-body text-ink-2">
        {message}
      </p>
    )
  }

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
      <p className="text-body text-ink-2">
        Type your username, or the email address on your account. If the account has an email
        address on it, we will send a link that lets you set a new password.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="identifier" className="text-label font-medium text-muted">
          Username or email
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={254}
          className={FIELD}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-button bg-accent px-4 text-body font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send the link'}
      </button>
    </form>
  )
}
