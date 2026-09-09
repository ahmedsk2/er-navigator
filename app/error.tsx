'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * The error boundary for every route below the root layout: a render or data error that would
 * otherwise drop the nurse onto Next's unstyled default page (final review, ui lens). Next
 * strips the message of a server error before it reaches the browser, so nothing here can leak
 * a query, a path or a stack. `reset()` re-renders the segment; the board link always works.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is what matches this screen to the server log line; the message itself is not
    // useful on the client for a server error.
    console.error('[er-navigator] route error', error.digest ?? error.message)
  }, [error])

  return (
    <main className="mx-auto max-w-md p-4 pt-8">
      <h1 className="text-title">Something went wrong</h1>
      <p className="mt-3 text-body text-ink-2">
        This screen could not be shown. Nothing you typed on a previous screen was changed by this. Try
        again, or go back to the board.
        {error.digest ? <span className="block text-caption text-muted">Reference {error.digest}</span> : null}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center rounded-button bg-accent px-4 text-body font-semibold text-white"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
        >
          ‹ Board
        </Link>
      </div>
    </main>
  )
}
