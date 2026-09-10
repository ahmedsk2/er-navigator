import Link from 'next/link'
import type { ReactNode } from 'react'
import { Wordmark } from './brand/Mark'

/**
 * The three holding screens — 403, 404 and the error boundary — and the two frames they need.
 *
 * `HoldingScreen` is the bare frame: a slim `.bg-header` band carrying the wordmark, and the
 * message in a white card below it. It is for the boundaries that render with no chrome at all
 * (a 404 anywhere, a refusal on `/cases/*` or `/report`, any route error), where without the
 * band the page arrives as text on a grey field and reads as broken rather than as the app
 * saying something.
 *
 * `HoldingCard` is the same card without the band, for `app/(app)/forbidden.tsx`. Next renders a
 * `forbidden()` from inside a layout *within* that layout, so a refusal on /export or /admin
 * already has the shell's header above it and a second band would print the name twice. Same
 * copy, same heading, one frame each — which is why the body lives here and not in the two route
 * files.
 */
export function HoldingScreen({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh">
      <div className="bg-header px-4 py-3">
        <Wordmark tone="onTeal" size="sm" />
      </div>
      <div className="mx-auto max-w-md p-4 pt-6">
        <Card>{children}</Card>
      </div>
    </main>
  )
}

export function HoldingCard({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-6 pb-6">
      <Card>{children}</Card>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-card border border-line bg-panel p-5 shadow-card">{children}</div>
}

/** The way back that every holding screen offers: the board, which every signed-in role can read. */
export function BoardLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink ${className}`}
    >
      ‹ Board
    </Link>
  )
}

/**
 * The body of every HTTP 403 this app serves (Phase 7). Deliberately short and role-neutral: the
 * page cannot know which action was refused — Next renders it without arguments — so it says the
 * true thing for all of them and points back at the board.
 */
export function NotAllowedBody() {
  return (
    <>
      <h1 className="text-title">Not allowed</h1>
      <p className="mt-3 text-body text-ink-2">
        Your role cannot open this screen. Nothing is wrong with your sign-in, and the attempt has
        been recorded. If you need it, ask an administrator to change your role.
      </p>
      <BoardLink className="mt-6" />
    </>
  )
}
