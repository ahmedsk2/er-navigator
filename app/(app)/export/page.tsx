import type { Metadata } from 'next'
import Link from 'next/link'
import { ExportPanel } from '@/src/components/export/ExportPanel'
import { isForbiddenError, requireAction, type AuthUser } from '@/src/lib/auth/session'
import { countCasesForExport } from '@/src/lib/export/load'
import { defaultExportRange } from '@/src/lib/export/range'

export const metadata: Metadata = { title: 'Export · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/export` — SUPERVISOR, ADMIN, VIEWER (`export.xlsx`). The tab is hidden for a NAVIGATOR, and
 * this page refuses one anyway with an `auth.forbidden` audit row: hiding a tab is not a
 * permission, and the two route handlers behind the buttons check the same action again.
 *
 * The first count is server-rendered for the default range so the page is honest before any
 * JavaScript runs; the panel re-counts through `GET /api/export/count` as the dates change.
 */
export default async function ExportPage() {
  const user = await userWhoMayExport()
  if (!user) return <Forbidden />

  const range = defaultExportRange(new Date())
  const count = await countCasesForExport(range)
  return <ExportPanel initialRange={range} initialCount={count} />
}

/** null means "refused, and the audit row is already written"; anything else is a real fault. */
async function userWhoMayExport(): Promise<AuthUser | null> {
  try {
    return await requireAction('export.xlsx')
  } catch (error) {
    if (isForbiddenError(error)) return null
    throw error
  }
}

function Forbidden() {
  return (
    <div className="px-4 pt-4 pb-6">
      <h2 className="text-title">Not allowed</h2>
      <p className="mt-3 text-body text-ink-2">
        Your role can open and update cases, but the Excel export and the department report are for
        charge nurses, administrators and leadership. Ask one of them for the file.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-button border border-line bg-panel px-4 text-body font-semibold text-accent-ink"
      >
        ‹ Board
      </Link>
    </div>
  )
}
