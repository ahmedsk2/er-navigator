import type { Metadata } from 'next'
import { DashboardView } from '@/src/components/dashboard/DashboardView'
import { DrillView } from '@/src/components/dashboard/DrillView'
import { requireAction } from '@/src/lib/auth/session'
import { loadBoardRowsByIds } from '@/src/lib/board/load'
import { parseDrill, parseRange, resolveDrill } from '@/src/lib/dashboard/drill'
import { loadCasesForStats } from '@/src/lib/dashboard/load'
import { dashboard } from '@/src/lib/domain/aggregates'

export const metadata: Metadata = { title: 'Dashboard · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/dashboard` — every role (`dashboard.view` is ALL); the layout has already required a session,
 * and this page checks the action itself rather than trusting the layout to be the gate — a
 * layout is skipped on an RSC request that already carries its segment (review C1). Asking the
 * matrix rather than only for a session changes nothing for anybody today and makes the policy
 * load-bearing the day `dashboard.view` stops being ALL.
 *
 * One database read, one `dashboard()` call, then either the page or one drill-down out of the
 * same aggregates. `now` is the request time and the page does not poll: leadership reads this
 * on a laptop and reloads it, unlike the board, which a nurse leaves open on a phone all shift.
 *
 * An unresolvable `?drill=` — a section this page does not have, or a row that has fallen out of
 * the chosen range — renders the dashboard. A bad query string is a stale bookmark, not an error.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string | string[]; drill?: string | string[] }>
}) {
  await requireAction('dashboard.view')
  const params = await searchParams
  const range = parseRange(params.r)
  const now = new Date()

  const cases = await loadCasesForStats()
  const data = dashboard(cases, range, now)

  const key = parseDrill(params.drill)
  const drill = key ? resolveDrill(data, key) : null
  if (drill) {
    const rows = await loadBoardRowsByIds(drill.ids)
    return <DrillView label={drill.label} rows={rows} range={range} now={now} />
  }

  return <DashboardView data={data} range={range} />
}
