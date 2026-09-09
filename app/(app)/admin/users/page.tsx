import type { Metadata } from 'next'
import { UsersPanel } from '@/src/components/admin/UsersPanel'
import { loadUsers } from '@/src/lib/admin/users'
import { requireUser } from '@/src/lib/auth/session'

export const metadata: Metadata = { title: 'Users · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/** ADMIN only; the layout is the gate and every mutation checks `admin.users` again. */
export default async function AdminUsersPage() {
  const [user, users] = await Promise.all([requireUser(), loadUsers()])
  return <UsersPanel users={users} currentUserId={user.id} />
}
