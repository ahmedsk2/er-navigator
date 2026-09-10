import type { Metadata } from 'next'
import { DashboardView } from '@/src/components/dashboard/DashboardView'
import { DrillView } from '@/src/components/dashboard/DrillView'
import { requireAction } from '@/src/lib/auth/session'
import { loadBoardRowsByIds } from '@/src/lib/board/load'
import { loadReference } from '@/src/lib/cases/reference'
import { parseDrill, parseRange, resolveDrill } from '@/src/lib/dashboard/drill'
import { loadCasesForStats } from '@/src/lib/dashboard/load'
import { dashboard } from '@/src/lib/domain/aggregates'
import { filterOptionsOf, matchesFilter, parseCaseFilter } from '@/src/lib/domain/case-filter'

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
 * The Phase 10 case filter is applied to the loaded cases BEFORE `dashboard()` runs, so every
 * section, the headline, `total` and the previous period are all over the same filtered
 * population — there is no half-filtered figure on the page, because there is only one call.
 * `total` narrowing with it is the point: "6 of 9 cases" under a filter means six of the nine
 * cases the filter kept, which is what the footnote under it says in words.
 *
 * An unresolvable `?drill=` — a section this page does not have, or a row that has fallen out of
 * the chosen range — renders the dashboard. A bad query string is a stale bookmark, not an error.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAction('dashboard.view')
  const params = await searchParams
  const range = parseRange(params.r)
  const filter = parseCaseFilter(params)
  const now = new Date()

  const [loaded, reference] = await Promise.all([loadCasesForStats(), loadReference()])
  const cases = loaded.filter((c) => matchesFilter(c, filter))
  const data = dashboard(cases, range, now)
  const filterOptions = filterOptionsOf(reference)

  const key = parseDrill(params.drill)
  const drill = key ? resolveDrill(data, key) : null
  if (drill) {
    const rows = await loadBoardRowsByIds(drill.ids)
    return <DrillView label={drill.label} rows={rows} range={range} filter={filter} now={now} />
  }

  return <DashboardView data={data} range={range} filter={filter} filterOptions={filterOptions} />
}
