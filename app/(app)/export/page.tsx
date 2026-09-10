import type { Metadata } from 'next'
import { ExportPanel } from '@/src/components/export/ExportPanel'
import { requireAction } from '@/src/lib/auth/session'
import { loadReference } from '@/src/lib/cases/reference'
import { filterOptionsOf } from '@/src/lib/domain/case-filter'
import { countCasesForExport } from '@/src/lib/export/load'
import { parseExportRange } from '@/src/lib/export/range'

export const metadata: Metadata = { title: 'Export · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/export` — SUPERVISOR, ADMIN, VIEWER (`export.xlsx`). The tab is hidden for a NAVIGATOR, and
 * this page refuses one anyway with an `auth.forbidden` audit row and an HTTP 403 carrying
 * `app/forbidden.tsx` (Phase 7): hiding a tab is not a permission, and the two route handlers
 * behind the buttons check the same action again.
 *
 * The first count is server-rendered for the range in the address so the page is honest before
 * any JavaScript runs; the panel re-counts through `GET /api/export/count` as the dates change.
 * Since Phase 10 the address may also carry a case filter, which the panel applies to the count
 * and both downloads alike — a filter is a navigation here as it is on the other two pages, so
 * the whole request is one link.
 */
export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAction('export.xlsx')

  const range = parseExportRange(await searchParams, new Date())
  const [count, reference] = await Promise.all([countCasesForExport(range), loadReference()])
  return <ExportPanel initialRange={range} initialCount={count} filterOptions={filterOptionsOf(reference)} />
}
