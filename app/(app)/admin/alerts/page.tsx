import type { Metadata } from 'next'
import { AlertsPanel } from '@/src/components/admin/AlertsPanel'
import { loadAlerts } from '@/src/lib/alerts/service'
import { requireRole } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'

export const metadata: Metadata = { title: 'Alerts · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/admin/alerts` — every threshold the worker recorded, newest first.
 *
 * The screen is ADMIN like the rest of `/admin/*`, and says so itself rather than trusting the
 * layout, which Next skips on an RSC request that already carries the `admin` segment (review
 * C1). It has no action of its own in the locked matrix and inventing one would edit the matrix,
 * so it states the role: `requireRole('ADMIN')` writes the same `auth.forbidden` row.
 *
 * Acknowledging is SUPERVISOR and ADMIN, and a supervisor reaches it where they actually are:
 * the case editor's header, which offers the same control when the case has an unacknowledged
 * alert.
 */
export default async function AdminAlertsPage() {
  const user = await requireRole('ADMIN')
  const alerts = await loadAlerts()
  return <AlertsPanel alerts={alerts} canAcknowledge={can(user.role, 'alert.acknowledge')} />
}
