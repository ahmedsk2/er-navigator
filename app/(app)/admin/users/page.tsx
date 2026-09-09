import type { Metadata } from 'next'
import { UsersPanel } from '@/src/components/admin/UsersPanel'
import { loadUsers } from '@/src/lib/admin/users'
import { requireAction } from '@/src/lib/auth/session'

export const metadata: Metadata = { title: 'Users · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * ADMIN only. `requireAction('admin.users')`, not the bare `requireUser()` this page used to
 * make: any signed-in role passed that, and the admin layout — the only real gate — is skipped on
 * an RSC request that already carries the `admin` segment (review C1). The directory this loads
 * is the whole staff list, so the guard runs before the query, not beside it.
 */
export default async function AdminUsersPage() {
  const user = await requireAction('admin.users')
  const users = await loadUsers()
  return <UsersPanel users={users} currentUserId={user.id} />
}
