import type { Metadata } from 'next'
import { Placeholder } from '@/src/components/shell/Placeholder'
import { requireUser } from '@/src/lib/auth/session'
import { can } from '@/src/lib/authz/policy'

export const metadata: Metadata = { title: 'Admin · ER Navigator' }

/**
 * ADMIN only, checked on the server as well as hidden from the tab bar — hiding a tab is not a
 * permission. No audit row: this is a read of a placeholder, not a refused mutation.
 */
export default async function AdminPage() {
  const user = await requireUser()
  if (!can(user.role, 'admin.users')) {
    return (
      <Placeholder title="Not allowed" phase="Admin">
        Your role can read the board and the dashboard. Ask an administrator for anything on this
        screen.
      </Placeholder>
    )
  }

  return (
    <Placeholder title="Admin" phase="Phase 6">
      Users, the reference lists, the &quot;Other&quot; review queue, the audit viewer and the
      threshold alerts land here.
    </Placeholder>
  )
}
