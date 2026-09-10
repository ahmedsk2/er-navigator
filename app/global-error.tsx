'use client'

import Link from 'next/link'

/**
 * The last resort: an error thrown by the root layout itself. It replaces the whole document,
 * so it renders its own <html> and <body> and cannot use the app's font or stylesheet with
 * certainty; plain markup and a hard link to the board are all it needs.
 *
 * Which is why every colour here is a hand copy of a design token rather than a class, the
 * header band is a literal gradient rather than `.bg-header`, and the mark is drawn inline
 * rather than imported from `src/components/brand/Mark.tsx`, whose tile is Tailwind. The hand
 * copy is the part that drifts, so `tests/unit/colour-literals.test.ts` checks every hex on this
 * page against the @theme block.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, color: '#16243b', background: '#f5f7f6' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #1f7a8c, #155d6b)',
            color: '#ffffff',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#ffffff',
              color: '#1f7a8c',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 6.5-7 11-7 11z" />
              <path d="M6 12h3l1.5-3 2 6 1.5-3H18" />
            </svg>
          </span>
          <b style={{ fontSize: 15 }}>ER Navigator</b>
        </div>
        <main style={{ maxWidth: '28rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #d9dfdb',
              borderRadius: 12,
              padding: '1.25rem',
              boxShadow: '0 2px 8px rgb(16 36 59 / 0.05)',
            }}
          >
            <h1 style={{ fontSize: '1.25rem', margin: 0 }}>ER Navigator could not load</h1>
            <p style={{ marginTop: '0.75rem', lineHeight: 1.5 }}>
              The page failed before it could draw. Nothing you typed was changed by this.
              {error.digest ? <span style={{ display: 'block', fontSize: '0.85rem', color: '#5b6673' }}>Reference {error.digest}</span> : null}
            </p>
            <p style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ minHeight: '2.75rem', padding: '0 1rem', borderRadius: 10, border: 0, background: '#1f7a8c', color: '#ffffff', fontWeight: 600 }}
              >
                Try again
              </button>
              <Link
                href="/"
                style={{ minHeight: '2.75rem', display: 'inline-flex', alignItems: 'center', padding: '0 1rem', borderRadius: 10, border: '1px solid #d9dfdb', background: '#ffffff', color: '#155d6b', fontWeight: 600, textDecoration: 'none' }}
              >
                ‹ Board
              </Link>
            </p>
          </div>
        </main>
      </body>
    </html>
  )
}
