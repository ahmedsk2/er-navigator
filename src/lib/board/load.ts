/**
 * Reading the board. One `findMany` with the relations selected — the primary reason's name, the
 * consulted departments, the ward code and the newest update's timestamp — so a hundred rows
 * cost the same handful of statements as one. Nothing loops over cases issuing queries.
 *
 * VOIDED never leaves this module: the status filter is a whitelist, and the mapper drops
 * anything else a second time. A voided case is invisible on the board by construction, not by
 * remembering to filter it in the UI.
 */
import type { CaseStatus } from '@prisma/client'
import { timelineOf } from '@/src/lib/cases/timeline'
import { prisma } from '@/src/lib/db'
import { isEmptyFilter, matchesFilter, type CaseFilter } from '@/src/lib/domain/case-filter'
import type { KpiInvestigationType } from '@/src/lib/domain/kpi'
import { filterableOf } from './rows'
import type { BoardFilter, BoardPayload, BoardRow, BoardStatus } from './types'

const STATUSES: Record<BoardFilter, ReadonlyArray<CaseStatus>> = {
  open: ['OPEN'],
  resolved: ['RESOLVED'],
  all: ['OPEN', 'RESOLVED'],
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

/**
 * Exactly what a row draws. Shared by the board and by the dashboard's drill-down lists.
 *
 * Phase 8 widened it by the journey milestones, the admission and transfer chains and the two
 * child tables' own timestamps, because the handover sheet now prints each case's time sequence
 * and that sequence has to match the rows the board is showing at that moment (see
 * `BoardRow.timeline`). It is the same one query either way: twelve more scalar columns and one
 * more join.
 */
const BOARD_ROW_SELECT = {
  id: true,
  mrn: true,
  status: true,
  registrationAt: true,
  departedAt: true,
  resolvedAt: true,
  disposition: true,
  createdAt: true,
  ctas: true,
  // Phase 10: the payer's chip and the working-diagnosis line.
  payer: true,
  diagnosis: true,
  // Phase 8b, decision H: the row's "Reviewed" chip.
  reviewedAt: true,
  triageAt: true,
  roomAt: true,
  physicianAt: true,
  decisionAt: true,
  admOrderAt: true,
  bedRequestedAt: true,
  bedAssignedAt: true,
  handoverAt: true,
  transferRequestedAt: true,
  transferAcceptedAt: true,
  transportArrivedAt: true,
  painkillerAt: true,
  caseMgmtCalledAt: true,
  caseMgmtRepliedAt: true,
  medAdminInformedAt: true,
  primaryReason: { select: { name: true } },
  ward: { select: { code: true } },
  area: { select: { code: true } },
  // Phase 10: not drawn, matched. `sortOrder` only so the two lists come out in taxonomy order,
  // the same order `toCaseForStats` builds them in, so a chip reads the same wherever it is shown.
  reasons: {
    select: { reason: { select: { name: true, stage: { select: { code: true, sortOrder: true } } } } },
  },
  consults: {
    orderBy: { department: { sortOrder: 'asc' } },
    select: {
      department: { select: { name: true } },
      consultedAt: true,
      seenAt: true,
      repliedAt: true,
    },
  },
  investigations: {
    select: {
      type: true,
      orderedAt: true,
      collectedAt: true,
      receivedAt: true,
      doneAt: true,
      preliminaryAt: true,
      resultedAt: true,
    },
  },
  updates: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} as const

type Milestones = {
  triageAt: Date | null
  roomAt: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
  handoverAt: Date | null
  transferRequestedAt: Date | null
  transferAcceptedAt: Date | null
  transportArrivedAt: Date | null
  medAdminInformedAt: Date | null
  painkillerAt: Date | null
  caseMgmtCalledAt: Date | null
  caseMgmtRepliedAt: Date | null
}

type SelectedRow = Milestones & {
  id: string
  mrn: string
  status: CaseStatus
  registrationAt: Date
  departedAt: Date | null
  resolvedAt: Date | null
  disposition: BoardRow['disposition']
  createdAt: Date
  ctas: number | null
  payer: BoardRow['payer']
  diagnosis: string | null
  reviewedAt: Date | null
  primaryReason: { name: string } | null
  ward: { code: string } | null
  area: { code: string } | null
  reasons: ReadonlyArray<{ reason: { name: string; stage: { code: string; sortOrder: number } } }>
  consults: ReadonlyArray<{
    department: { name: string }
    consultedAt: Date | null
    seenAt: Date | null
    repliedAt: Date | null
  }>
  investigations: ReadonlyArray<{
    // Named rather than spelled out, so adding a type to the schema (Phase 8b's MRI) does not
    // need this row rewritten — the timeline the board carries is built by `kpi.ts` either way.
    type: KpiInvestigationType
    orderedAt: Date | null
    collectedAt: Date | null
    receivedAt: Date | null
    doneAt: Date | null
    preliminaryAt: Date | null
    resultedAt: Date | null
  }>
  updates: ReadonlyArray<{ createdAt: Date }>
}

function toBoardRow(row: SelectedRow): BoardRow {
  const reasonsInOrder = [...row.reasons].sort((a, b) => a.reason.stage.sortOrder - b.reason.stage.sortOrder)
  return {
    id: row.id,
    mrn: row.mrn,
    status: row.status as BoardStatus,
    registrationAt: row.registrationAt.toISOString(),
    departedAt: iso(row.departedAt),
    resolvedAt: iso(row.resolvedAt),
    ctas: row.ctas,
    area: row.area?.code ?? null,
    payer: row.payer,
    diagnosis: row.diagnosis,
    primaryReason: row.primaryReason?.name ?? null,
    stageCodes: [...new Set(reasonsInOrder.map((r) => r.reason.stage.code))],
    reasonNames: [...new Set(reasonsInOrder.map((r) => r.reason.name))],
    departments: row.consults.map((consult) => consult.department.name),
    disposition: row.disposition,
    ward: row.ward?.code ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUpdateAt: iso(row.updates[0]?.createdAt ?? null),
    reviewedAt: iso(row.reviewedAt),
    timeline: timelineOf({
      status: row.status,
      registrationAt: row.registrationAt,
      departedAt: row.departedAt,
      resolvedAt: row.resolvedAt,
      triageAt: row.triageAt,
      roomAt: row.roomAt,
      physicianAt: row.physicianAt,
      decisionAt: row.decisionAt,
      admOrderAt: row.admOrderAt,
      bedRequestedAt: row.bedRequestedAt,
      bedAssignedAt: row.bedAssignedAt,
      handoverAt: row.handoverAt,
      transferRequestedAt: row.transferRequestedAt,
      transferAcceptedAt: row.transferAcceptedAt,
      transportArrivedAt: row.transportArrivedAt,
      painkillerAt: row.painkillerAt,
      caseMgmtCalledAt: row.caseMgmtCalledAt,
      caseMgmtRepliedAt: row.caseMgmtRepliedAt,
      medAdminInformedAt: row.medAdminInformedAt,
      consults: row.consults.map((consult) => ({
        departmentName: consult.department.name,
        consultedAt: consult.consultedAt,
        seenAt: consult.seenAt,
        repliedAt: consult.repliedAt,
      })),
      investigations: row.investigations,
    }),
  }
}

/**
 * The case filter (Phase 10) is applied here, in memory, after the query.
 *
 * Not in SQL, deliberately. "The lone finding" is a set equality over the case's reasons and its
 * consulted teams, which Prisma cannot express in one `where` without a subquery per dimension,
 * and the board is a few hundred open cases the query already returns in full for the counts
 * strip and the handover sheet. One predicate, three pages, the same answer — which is the whole
 * reason `matchesFilter` is pure. If the board ever outgrows this, the query is where to look.
 */
export async function loadBoardRows(filter: BoardFilter, caseFilter?: CaseFilter): Promise<BoardRow[]> {
  const rows = await prisma.case.findMany({
    where: { status: { in: [...STATUSES[filter]] } },
    // A stable base order; the board sorts by elapsed hours on top of it, and a stable input
    // means two renders of equal clocks never shuffle.
    orderBy: [{ registrationAt: 'asc' }, { id: 'asc' }],
    select: BOARD_ROW_SELECT,
  })

  const mapped = rows.filter((row) => row.status !== 'VOIDED').map(toBoardRow)
  if (!caseFilter || isEmptyFilter(caseFilter)) return mapped
  return mapped.filter((row) => matchesFilter(filterableOf(row), caseFilter))
}

/**
 * The same rows, for a set of ids the dashboard already resolved (Phase 4 drill-downs). The
 * VOIDED filter stays: a drill-down can only ever contain ids `dashboard()` produced, and those
 * exclude voided cases, but a second guard here costs nothing and means no caller can bypass it.
 */
export async function loadBoardRowsByIds(ids: ReadonlyArray<string>): Promise<BoardRow[]> {
  if (ids.length === 0) return []
  const rows = await prisma.case.findMany({
    where: { id: { in: [...ids] }, status: { in: ['OPEN', 'RESOLVED'] } },
    orderBy: [{ registrationAt: 'asc' }, { id: 'asc' }],
    select: BOARD_ROW_SELECT,
  })
  return rows.filter((row) => row.status !== 'VOIDED').map(toBoardRow)
}

/**
 * The open cases' registration stamps, for the counts strip on the Resolved tab.
 *
 * Scalar-only when no case filter is active, which is the query this has always issued. Under a
 * filter the counts strip must describe the filtered board, and "does this open case match" is a
 * question about its reasons, its teams and its area — so the full row is loaded and filtered
 * through the same predicate the visible rows went through.
 */
async function loadOpenRegistrations(caseFilter?: CaseFilter): Promise<string[]> {
  if (caseFilter && !isEmptyFilter(caseFilter)) {
    return (await loadBoardRows('open', caseFilter)).map((row) => row.registrationAt)
  }
  const rows = await prisma.case.findMany({
    where: { status: 'OPEN' },
    select: { registrationAt: true },
  })
  return rows.map((row) => row.registrationAt.toISOString())
}

/**
 * Everything one board render needs. On the Open and All tabs the open cases are already in
 * `rows`, so the counts cost nothing; only the Resolved tab pays for the extra scalar read.
 */
export async function loadBoard(
  filter: BoardFilter,
  now: Date,
  caseFilter?: CaseFilter,
): Promise<BoardPayload> {
  const filtered = caseFilter && !isEmptyFilter(caseFilter) ? caseFilter : undefined
  const rows = await loadBoardRows(filter, filtered)
  const openRegistrations =
    filter === 'resolved'
      ? await loadOpenRegistrations(filtered)
      : rows.filter((row) => row.status === 'OPEN').map((row) => row.registrationAt)
  // The unfiltered denominator, and only when it can differ from the numerator: one indexed count
  // for the filter bar's "{shown} of {total} open cases", and no query at all on an unfiltered board.
  const totalOpen = filtered
    ? await prisma.case.count({ where: { status: 'OPEN' } })
    : openRegistrations.length
  return { filter, rows, openRegistrations, totalOpen, now: now.toISOString() }
}
