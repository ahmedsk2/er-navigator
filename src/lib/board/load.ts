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
import { prisma } from '@/src/lib/db'
import type { BoardFilter, BoardPayload, BoardRow, BoardStatus } from './types'

const STATUSES: Record<BoardFilter, ReadonlyArray<CaseStatus>> = {
  open: ['OPEN'],
  resolved: ['RESOLVED'],
  all: ['OPEN', 'RESOLVED'],
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

export async function loadBoardRows(filter: BoardFilter): Promise<BoardRow[]> {
  const rows = await prisma.case.findMany({
    where: { status: { in: [...STATUSES[filter]] } },
    // A stable base order; the board sorts by elapsed hours on top of it, and a stable input
    // means two renders of equal clocks never shuffle.
    orderBy: [{ registrationAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      mrn: true,
      status: true,
      registrationAt: true,
      departedAt: true,
      resolvedAt: true,
      disposition: true,
      createdAt: true,
      primaryReason: { select: { name: true } },
      ward: { select: { code: true } },
      consults: {
        orderBy: { department: { sortOrder: 'asc' } },
        select: { department: { select: { name: true } } },
      },
      updates: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  })

  return rows
    .filter((row) => row.status !== 'VOIDED')
    .map((row) => ({
      id: row.id,
      mrn: row.mrn,
      status: row.status as BoardStatus,
      registrationAt: row.registrationAt.toISOString(),
      departedAt: iso(row.departedAt),
      resolvedAt: iso(row.resolvedAt),
      primaryReason: row.primaryReason?.name ?? null,
      departments: row.consults.map((consult) => consult.department.name),
      disposition: row.disposition,
      ward: row.ward?.code ?? null,
      createdAt: row.createdAt.toISOString(),
      lastUpdateAt: iso(row.updates[0]?.createdAt ?? null),
    }))
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
