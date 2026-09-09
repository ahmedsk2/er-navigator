'use client'

import Link from 'next/link'

/**
 * The last resort: an error thrown by the root layout itself. It replaces the whole document,
 * so it renders its own <html> and <body> and cannot use the app's font or stylesheet with
 * certainty; plain markup and a hard link to the board are all it needs.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem 1rem', color: '#16243b', background: '#f5f7f6' }}>
        <main style={{ maxWidth: '28rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>ER Navigator could not load</h1>
          <p style={{ marginTop: '0.75rem', lineHeight: 1.5 }}>
            The page failed before it could draw. Nothing you typed was changed by this.
            {error.digest ? <span style={{ display: 'block', fontSize: '0.85rem', color: '#5b6673' }}>Reference {error.digest}</span> : null}
          </p>
          <p style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ minHeight: '2.75rem', padding: '0 1rem', borderRadius: 10, border: 0, background: '#1f7a8c', color: '#fff', fontWeight: 600 }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{ minHeight: '2.75rem', display: 'inline-flex', alignItems: 'center', padding: '0 1rem', borderRadius: 10, border: '1px solid #d9dfdb', background: '#fff', color: '#155d6b', fontWeight: 600, textDecoration: 'none' }}
            >
              ‹ Board
            </Link>
          </p>
        </main>
      </body>
    </html>
  )
}
