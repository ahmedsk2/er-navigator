import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/src/lib/auth/session'
import { loadCaseForEditor } from '@/src/lib/cases/load'
import { loadReferenceForCase } from '@/src/lib/cases/reference'
import { summaryOf } from '@/src/lib/cases/summary'

/**
 * `GET /api/cases/[id]/summary` — the case summary for the board's row button (Phase 10).
 *
 * The case page computes the same object on the server and never calls this; the board cannot,
 * because it holds a row and not a case, and loading every case's summary for a board of forty
 * would be forty joins for a panel the nurse may never open. One tap, one read.
 *
 * Every role may read a case (`case.view` is ALL), so this needs a session and nothing more —
 * and answers a missing one with 401 rather than the HTML login page, which a `fetch` cannot
 * use, exactly as `/api/board` does.
 *
 * A voided case is 404 here even though the case PAGE still shows it read-only: the board never
 * lists a voided case, so a summary request for one is not a nurse tapping a row. Never cached:
 * the summary carries an elapsed clock.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireUser({ as: 'api' })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
    }
    throw error
  }

  const { id } = await context.params
  const reference = await loadReferenceForCase(id)
  const loaded = await loadCaseForEditor(id, reference)
  if (!loaded || loaded.status === 'VOIDED') {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json(summaryOf(loaded, reference, new Date()), { headers: NO_STORE })
}
