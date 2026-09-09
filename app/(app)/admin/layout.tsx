import Link from 'next/link'
import { requireUser } from '@/src/lib/auth/session'
import { AdminNav } from './nav'

/**
 * `/admin/*` is ADMIN only (Phase 6 spec). The tab is hidden for everyone else, but hiding a tab
 * is not a permission, so the gate is here — once, for every admin screen — and each mutation
 * checks its own action again in the service, where the `auth.forbidden` audit row is written.
 *
 * No audit row for reaching this screen: a refused *read* of an admin page is not a mutation, and
 * the board's own placeholder has said the same since Phase 3.
 *
 * `data-wide` relaxes the shell's phone-width column (see `app/(app)/layout.tsx`): admin is
 * desktop-first at 1280 and still usable at 390.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  if (user.role !== 'ADMIN') {
    return (
      <div className="px-4 pt-4 pb-6">
        <h2 className="text-title">Not allowed</h2>
        <p className="mt-3 text-body text-ink-2">
          Administration — users, the reference lists, the review queue, the alerts and the audit
          log — is for administrators. Everything you can do is on the board and the dashboard.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
        >
          ‹ Board
        </Link>
      </div>
    )
  }

  return (
    <div data-wide className="px-4 pt-4 pb-6">
      <h2 className="text-title">Administration</h2>
      <AdminNav />
      {children}
    </div>
  )
}
