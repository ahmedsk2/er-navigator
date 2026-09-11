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
          {/* The mark (Phase 11), a hand copy of `Mark tone="onTeal"` at 28 px: this page replaces the
              root layout, so neither the component's classes nor the stylesheet are there. The
              outlines are those of src/components/brand/mark-paths.json; brand.test.ts checks. */}
          <svg aria-hidden="true" focusable="false" width={28} height={28} viewBox="0 0 48 48">
            <rect width={48} height={48} rx={10.56} fill="#ffffff" />
            <g
              transform="translate(6.72 6.72) scale(0.72)"
              fill="#0f4d5c"
              stroke="#0f4d5c"
              strokeWidth={1}
              strokeLinejoin="miter"
            >
              <path d="M30.851 1.984L30.851 28.322L44.033 28.322L44.033 15.166L34.818 15.166L34.818 17.149L42.049 17.149L42.049 26.338L32.834 26.338L32.834 0L15.166 0L15.166 1.984Z" />
              <path d="M46.016 15.166L46.016 30.851L28.867 30.851L28.867 3.967L15.166 3.967L15.166 13.182L22.916 13.182L22.916 36.802L30.851 36.802L30.851 42.049L21.117 42.049L21.117 15.166L0 15.166L0 32.834L1.984 32.834L1.984 17.149L19.133 17.149L19.133 44.033L32.834 44.033L32.834 34.818L24.9 34.818L24.9 11.198L17.149 11.198L17.149 5.951L26.883 5.951L26.883 32.834L48 32.834L48 15.166Z" />
              <path d="M17.149 46.016L17.149 19.678L3.967 19.678L3.967 32.834L13.182 32.834L13.182 30.851L5.951 30.851L5.951 21.662L15.166 21.662L15.166 48L32.834 48L32.834 46.016Z" />
            </g>
          </svg>
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
