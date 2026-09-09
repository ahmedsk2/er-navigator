import type { Metadata } from 'next'
import { Placeholder } from '@/src/components/shell/Placeholder'
import { requireUser } from '@/src/lib/auth/session'

export const metadata: Metadata = { title: 'Export · ER Navigator' }

/** The tab exists from Phase 3 so the shell is real; the workbook and /report arrive in Phase 5. */
export default async function ExportPage() {
  await requireUser()
  return (
    <Placeholder title="Export" phase="Phase 5">
      The Excel workbook and the printable report land here. The shift handover sheet is already
      available from the board: open the menu and choose Print handover.
    </Placeholder>
  )
}
