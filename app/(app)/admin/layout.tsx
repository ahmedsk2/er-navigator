import { requireRole } from '@/src/lib/auth/session'
import { AdminNav } from './nav'

/**
 * `/admin/*` is ADMIN only (Phase 6 spec). The tab is hidden for everyone else, but hiding a tab
 * is not a permission, so the gate is here — and, since Phase 7, in every page under it as well.
 *
 * This layout is defence in depth, not the boundary: Next skips ancestor layouts on an RSC
 * request whose `next-router-state-tree` already contains the segment, so a non-admin who has the
 * `admin` segment in their client router tree reaches the page without this file ever running
 * (review finding C1). Each page therefore calls `requireAction` or `requireRole` itself, and
 * each mutation checks its own action again in the service, where the audit row is written.
 *
 * `requireRole` replaces the raw role comparison this file used to make: a refusal is now an
 * HTTP 403 carrying `app/forbidden.tsx` plus an `auth.forbidden` audit row, not a 200 whose body
 * says no.
 *
 * `data-wide` relaxes the shell's phone-width column (see `app/(app)/layout.tsx`): admin is
 * desktop-first at 1280 and still usable at 390.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole('ADMIN')

  return (
    <div data-wide className="px-4 pt-4 pb-6">
      <h2 className="text-title">Administration</h2>
      <AdminNav />
      {children}
    </div>
  )
}
