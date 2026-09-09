import type { Metadata } from 'next'
import { AlertsPanel } from '@/src/components/admin/AlertsPanel'
import { loadAlerts } from '@/src/lib/alerts/service'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'

export const metadata: Metadata = { title: 'Alerts · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/admin/alerts` — every threshold the worker recorded, newest first.
 *
 * The page is ADMIN like the rest of `/admin/*` (the layout is the gate). Acknowledging is
 * SUPERVISOR and ADMIN, and a supervisor reaches it where they actually are: the case editor's
 * header, which offers the same control when the case has an unacknowledged alert.
 */
export default async function AdminAlertsPage() {
  const [user, alerts] = await Promise.all([requireUser(), loadAlerts()])
  return <AlertsPanel alerts={alerts} canAcknowledge={can(user.role, 'alert.acknowledge')} />
}
