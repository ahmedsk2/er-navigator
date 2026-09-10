import type { ReactNode } from 'react'
import { Wordmark } from './Mark'

/**
 * The frame the three holding screens share (Phase 9): a slim `.bg-header` band carrying the
 * wordmark, and the message in a white card below it. These pages render inside the root layout
 * only — no shell header, no tab bar — so without a band they arrive as text on a grey field and
 * read as a broken page rather than as the app saying something.
 *
 * The wordmark here is a `<span>`, never the `<h1>`: each of these screens owns its own heading
 * ("Not allowed", "Not found", "Something went wrong") and the specs select those by name.
 */
export function HoldingScreen({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh">
      <div className="bg-header px-4 py-3">
        <Wordmark tone="onTeal" size="sm" />
      </div>
      <div className="mx-auto max-w-md p-4 pt-6">
        <div className="rounded-card border border-line bg-panel p-5 shadow-card">{children}</div>
      </div>
    </main>
  )
}
