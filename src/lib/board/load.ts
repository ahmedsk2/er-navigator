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
  medAdminInformedAt: true,
  primaryReason: { select: { name: true } },
  ward: { select: { code: true } },
  area: { select: { code: true } },
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
  primaryReason: { name: string } | null
  ward: { code: string } | null
  area: { code: string } | null
  consults: ReadonlyArray<{
    department: { name: string }
    consultedAt: Date | null
    seenAt: Date | null
    repliedAt: Date | null
  }>
  investigations: ReadonlyArray<{
    type: 'LAB' | 'CT' | 'US' | 'XR'
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
  return {
    id: row.id,
    mrn: row.mrn,
    status: row.status as BoardStatus,
    registrationAt: row.registrationAt.toISOString(),
    departedAt: iso(row.departedAt),
    resolvedAt: iso(row.resolvedAt),
    ctas: row.ctas,
    area: row.area?.code ?? null,
    primaryReason: row.primaryReason?.name ?? null,
    departments: row.consults.map((consult) => consult.department.name),
    disposition: row.disposition,
    ward: row.ward?.code ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUpdateAt: iso(row.updates[0]?.createdAt ?? null),
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

export async function loadBoardRows(filter: BoardFilter): Promise<BoardRow[]> {
  const rows = await prisma.case.findMany({
    where: { status: { in: [...STATUSES[filter]] } },
    // A stable base order; the board sorts by elapsed hours on top of it, and a stable input
    // means two renders of equal clocks never shuffle.
    orderBy: [{ registrationAt: 'asc' }, { id: 'asc' }],
    select: BOARD_ROW_SELECT,
  })

  return rows.filter((row) => row.status !== 'VOIDED').map(toBoardRow)
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

/** Scalar-only read of the open cases, for the counts strip on the Resolved tab. */
async function loadOpenRegistrations(): Promise<string[]> {
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
export async function loadBoard(filter: BoardFilter, now: Date): Promise<BoardPayload> {
  const rows = await loadBoardRows(filter)
  const openRegistrations =
    filter === 'resolved'
      ? await loadOpenRegistrations()
      : rows.filter((row) => row.status === 'OPEN').map((row) => row.registrationAt)
  return { filter, rows, openRegistrations, now: now.toISOString() }
}
