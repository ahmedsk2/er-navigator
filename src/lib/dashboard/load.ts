/**
 * Reading the dashboard. One `findMany` for every non-voided case with the four relations
 * `CaseForStats` needs — the primary reason's name, the reasons with their stage, the consults
 * with their department, the investigations — mapped once by `toCaseForStats` and handed to
 * `dashboard()`. Nothing here counts anything: the maths lives in `src/lib/domain/aggregates.ts`
 * and is tested against a fixture with hand-computed answers.
 *
 * The whole page is one query on purpose. A dashboard that fired a query per section would be
 * fifteen round trips for a page leadership reloads, and the aggregates need the same case list
 * for every section anyway.
 */
import { CASE_STATS_SELECT, toCaseForStats } from '@/src/lib/cases/stats-mapper'
import { prisma } from '@/src/lib/db'
import type { CaseForStats } from '@/src/lib/domain/aggregates'

export async function loadCasesForStats(): Promise<CaseForStats[]> {
  const rows = await prisma.case.findMany({
    // The status whitelist is the first of two guards; `inRange()` drops VOIDED again.
    where: { status: { in: ['OPEN', 'RESOLVED'] } },
    orderBy: [{ registrationAt: 'asc' }, { id: 'asc' }],
    select: CASE_STATS_SELECT,
  })
  return rows.map(toCaseForStats)
}
