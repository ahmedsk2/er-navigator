import type { Metadata } from 'next'
import { Board } from '@/src/components/board/Board'
import { requireUser } from '@/src/lib/auth/session'
import { loadBoard } from '@/src/lib/board/load'
import { parseFilter } from '@/src/lib/board/rows'
import { loadReference } from '@/src/lib/cases/reference'
import { caseFilterQuery, filterOptionsOf, parseCaseFilter } from '@/src/lib/domain/case-filter'

export const metadata: Metadata = { title: 'ER board · ER Navigator' }
export const dynamic = 'force-dynamic'

/**
 * `/` — the board, for every role (`case.view` is ALL).
 *
 * The rows are loaded and sorted here, on the server, so the first paint is the real board and
 * not a spinner; `Board` then keeps it current on a 30 s beat. `f` decides which cases the query
 * asks for, so it must be read here; `q` is a client-side filter over the rows already sent, so
 * it is only handed through as the input's initial value.
 *
 * The Phase 10 case filter is read here too, and applied to the rows the query returned (see
 * `loadBoardRows`). It is a navigation like `f`, not a client filter like `q`, because the counts
 * strip, the empty state and the handover sheet all have to be over the same set of cases.
 *
 * `key` is deliberate: a filter change is a navigation, and remounting is what discards the
 * previous tab's rows instead of showing them for one frame.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireUser()
  const params = await searchParams
  const filter = parseFilter(Array.isArray(params.f) ? params.f[0] : params.f)
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? ''
  const caseFilter = parseCaseFilter(params)

  const [payload, reference] = await Promise.all([
    loadBoard(filter, new Date(), caseFilter),
    loadReference(),
  ])

  return (
    <Board
      key={`${filter}:${caseFilterQuery(caseFilter)}`}
      initial={payload}
      initialQuery={query}
      caseFilter={caseFilter}
      filterOptions={filterOptionsOf(reference)}
      printedBy={user.displayName}
    />
  )
}
