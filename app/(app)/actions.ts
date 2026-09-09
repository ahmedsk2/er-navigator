'use server'

import { redirect } from 'next/navigation'
import { auditQuietly } from '@/src/lib/audit'
import {
  auditContext,
  clearSessionCookie,
  deleteSessionByToken,
  getSession,
  readSessionCookie,
} from '@/src/lib/auth/session'

export async function logout(): Promise<void> {
  const current = await getSession()
  const token = await readSessionCookie()
  if (token) await deleteSessionByToken(token)
  await clearSessionCookie()
  if (current) {
    await auditQuietly(
      { action: 'auth.logout', entity: 'User', entityId: current.user.id, after: { username: current.user.username } },
      await auditContext(current.user.id),
    )
  }
  redirect('/login')
}
