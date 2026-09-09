import type { Metadata } from 'next'
import { Placeholder } from '@/src/components/shell/Placeholder'
import { requireUser } from '@/src/lib/auth/session'

export const metadata: Metadata = { title: 'Dashboard · ER Navigator' }

/** The tab exists from Phase 3 so the shell is real; the numbers arrive in Phase 4. */
export default async function DashboardPage() {
  await requireUser()
  return (
    <Placeholder title="Dashboard" phase="Phase 4">
      Median length of stay, the threshold table, the weekly trend and every drill-down land here.
      Until then the board is the live view.
    </Placeholder>
  )
}
