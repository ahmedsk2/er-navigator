import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { loadBoard } from '@/src/lib/board/load'
import { parseFilter } from '@/src/lib/board/rows'

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

  const filter = parseFilter(new URL(request.url).searchParams.get('f'))
  const payload = await loadBoard(filter, new Date())
  return NextResponse.json(payload, { headers: NO_STORE })
}
