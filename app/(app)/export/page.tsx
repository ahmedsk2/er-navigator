import type { Metadata } from 'next'
import { ExportPanel } from '@/src/components/export/ExportPanel'
import { requireAction } from '@/src/lib/auth/session'
import { countCasesForExport } from '@/src/lib/export/load'
import { defaultExportRange } from '@/src/lib/export/range'

export const metadata: Metadata = { title: 'Export · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/export` — SUPERVISOR, ADMIN, VIEWER (`export.xlsx`). The tab is hidden for a NAVIGATOR, and
 * this page refuses one anyway with an `auth.forbidden` audit row and an HTTP 403 carrying
 * `app/forbidden.tsx` (Phase 7): hiding a tab is not a permission, and the two route handlers
 * behind the buttons check the same action again.
 *
 * The first count is server-rendered for the default range so the page is honest before any
 * JavaScript runs; the panel re-counts through `GET /api/export/count` as the dates change.
 */
export default async function ExportPage() {
  await requireAction('export.xlsx')

  const range = defaultExportRange(new Date())
  const count = await countCasesForExport(range)
  return <ExportPanel initialRange={range} initialCount={count} />
}
