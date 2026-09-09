import type { Metadata } from 'next'
import { ListsPanel } from '@/src/components/admin/ListsPanel'
import { loadReferenceLists } from '@/src/lib/admin/lists'
import { requireAction } from '@/src/lib/auth/session'

export const metadata: Metadata = { title: 'Reference lists · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * ADMIN only. The page checks `admin.lists` itself — the layout above it is defence in depth and
 * is skipped on an RSC request that already carries the `admin` segment (review C1) — and every
 * mutation checks the same action again in the service.
 */
export default async function AdminListsPage() {
  await requireAction('admin.lists')
  const lists = await loadReferenceLists()
  return <ListsPanel lists={lists} />
}
