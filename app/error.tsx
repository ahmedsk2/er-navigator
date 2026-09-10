'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { isStaleBuild } from '@/src/lib/build-check'

/**
 * The error boundary for every route below the root layout: a render or data error that would
 * otherwise drop the nurse onto Next's unstyled default page (final review, ui lens). Next
 * strips the message of a server error before it reaches the browser, so nothing here can leak
 * a query, a path or a stack. `reset()` re-renders the segment; the board link always works.
 *
 * One cause has its own remedy: a screen that stayed open across a deploy posts Server Action
 * ids the new build does not know, and `reset()` cannot help because the page itself is old.
 * The root layout stamps the page's build; when /api/health reports a different one the page
 * reloads itself and says so (10 September, the login page). Any other error keeps the buttons,
 * plus a full reload for the cases a re-render does not cure.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    // The digest is what matches this screen to the server log line; the message itself is not
    // useful on the client for a server error.
    console.error('[er-navigator] route error', error.digest ?? error.message)
  }, [error])

  useEffect(() => {
    let cancelled = false
    fetch('/api/health', { cache: 'no-store' })
      .then((res) => {
        if (cancelled) return
        if (isStaleBuild(document.documentElement.dataset.build, res.headers.get('x-build-fingerprint'))) {
          setReloading(true)
          window.location.reload()
        }
      })
      .catch(() => {
        // No verdict without the probe: the buttons below are the fallback.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (reloading) {
    return (
      <main className="mx-auto max-w-md p-4 pt-8">
        <h1 className="text-title">ER Navigator was updated</h1>
        <p className="mt-3 text-body text-ink-2">
          This screen was open while a new version went live. Reloading it now; nothing you typed on a
          previous screen was changed by this.
        </p>
      </main>
    )
  }

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
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
        >
          Reload
        </button>
      </div>
    </main>
  )
}
