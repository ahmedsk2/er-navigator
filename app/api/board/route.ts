import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { loadBoard } from '@/src/lib/board/load'
import { parseFilter } from '@/src/lib/board/rows'
import { parseCaseFilter } from '@/src/lib/domain/case-filter'

/**
 * The board's 30 s poll. Same payload as the server-rendered first paint, so the client swaps one
 * for the other without a second code path.
 *
 * Every role may read the board (`case.view` is ALL), so this only needs a session — and answers
 * a missing one with 401 rather than a redirect to an HTML login page, which a `fetch` cannot use.
 * Never cached: a board a minute out of date is worse than no board.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

export async function GET(request: Request): Promise<Response> {
  try {
    await requireUser({ as: 'api' })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
    }
    throw error
  }

  // The poll carries the case filter too (Phase 10): a board narrowed to one stage must stay
  // narrowed across the 30 s beat, and the counts strip must keep counting the same cases.
  const params = new URL(request.url).searchParams
  const filter = parseFilter(params.get('f'))
  const payload = await loadBoard(filter, new Date(), parseCaseFilter(params))
  return NextResponse.json(payload, { headers: NO_STORE })
}
