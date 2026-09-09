import type { Metadata } from 'next'
import { ListsPanel } from '@/src/components/admin/ListsPanel'
import { loadReferenceLists } from '@/src/lib/admin/lists'

export const metadata: Metadata = { title: 'Reference lists · Admin · ER Navigator' }
export const dynamic = 'force-dynamic'

/** ADMIN only; the layout is the gate and every mutation checks `admin.lists` again. */
export default async function AdminListsPage() {
  const lists = await loadReferenceLists()
  return <ListsPanel lists={lists} />
}
