/**
 * The board's wire shape. One type for the server-rendered first paint and for the 30 s
 * `GET /api/board` poll, so the row component cannot tell which one it is rendering.
 *
 * Plain JSON on purpose: every timestamp is an ISO-8601 UTC string, exactly as
 * `src/lib/cases/types.ts` does it, because this crosses both the RSC boundary and `fetch`.
 */
import type { Disposition } from '@prisma/client'

export const BOARD_FILTERS = ['open', 'resolved', 'all'] as const
export type BoardFilter = (typeof BOARD_FILTERS)[number]

/** VOIDED is never on the board (spec: phase3-board.md), so the row status has only two values. */
export type BoardStatus = 'OPEN' | 'RESOLVED'

/** Exactly the fields a row and the handover table need — nothing else leaves the database. */
export type BoardRow = {
  id: string
  mrn: string
  status: BoardStatus
  registrationAt: string
  departedAt: string | null
  resolvedAt: string | null
  /** The primary delay reason's name, or null when none was chosen. */
  primaryReason: string | null
  /** Consulted department names, in the taxonomy's order. */
  departments: string[]
  disposition: Disposition | null
  /** The ward's short code (ICU, FMW …), which is what fits on a phone row. */
  ward: string | null
  createdAt: string
  /** The newest `CaseUpdate.createdAt`, or null when the case has never been updated. */
  lastUpdateAt: string | null
}

export type BoardCounts = { open: number; past6: number; past12: number }

export type BoardPayload = {
  filter: BoardFilter
  rows: BoardRow[]
  /**
   * `registrationAt` of every OPEN case, whatever the filter is. The counts strip reads "open,
   * past 6h, past 12h" and must mean the same thing on the Resolved tab as on the Open tab; the
   * prototype could take that from its in-memory list, a server-filtered board cannot.
   */
  openRegistrations: string[]
  /** The server's clock at render time, so the first client render matches the HTML exactly. */
  now: string
}
