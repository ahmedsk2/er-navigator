import type { ReactNode } from 'react'
import { Wordmark } from '@/src/components/brand/Mark'

/**
 * The frame the two Phase 16 pages share (docs/specs/phase16-forgot-password.md).
 *
 * Not the sign-in screen's two-column hero: that picture is the front door, and a page you reach
 * from it by tapping a small link should read as a step inside the same building rather than as a
 * second front door. One card, the wordmark above it, centred on a laptop and full width on a
 * phone, from the tokens the rest of the app uses.
 */
export function PublicAuthCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 py-10 lg:grid lg:place-items-center lg:py-16">
      <div className="w-full lg:max-w-[420px]">
        <Wordmark as="h1" tone="onWhite" size="md" />
        <div
          data-auth-card
          className="mt-8 w-full rounded-card border border-line bg-panel p-6 shadow-card lg:p-8"
        >
          <p className="text-title">{title}</p>
          {children}
        </div>
      </div>
    </main>
  )
}
