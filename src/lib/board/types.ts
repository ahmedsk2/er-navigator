/**
 * The board's wire shape. One type for the server-rendered first paint and for the 30 s
 * `GET /api/board` poll, so the row component cannot tell which one it is rendering.
 *
 * Plain JSON on purpose: every timestamp is an ISO-8601 UTC string, exactly as
 * `src/lib/cases/types.ts` does it, because this crosses both the RSC boundary and `fetch`.
 */
import type { Disposition } from '@prisma/client'
import type { TimelineStepView } from '@/src/lib/cases/timeline'

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
  /** Triage acuity 1..5, or null when it was not recorded (Phase 8). */
  ctas: number | null
  /**
   * The ED area's short code (RESUS, RAZ …), or null. The code, not the name, for the same
   * reason `ward` is a code: it is what fits on a phone row beside the MRN.
   */
  area: string | null
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
  /**
   * When a supervisor last marked the case reviewed, or null (Phase 8b, decision H). The row
   * shows it as a small chip and nothing else: the reviewer's name and the exact time belong on
   * the case page, and a board row has one line to say what happened to the patient.
   */
  reviewedAt: string | null
  /**
   * The case's recorded milestones in time order (Phase 8), for the compact timeline on the
   * handover sheet. It rides on the row rather than being fetched for the sheet alone because
   * the sheet prints whatever the board is currently showing — filtered and sorted in the
   * browser — so a timeline loaded once for the first paint would be missing for any case the
   * 30 s poll brought in since. A case with nothing recorded but its registration carries a
   * single step, and the sheet then prints no timeline line for it.
   */
  timeline: TimelineStepView[]
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
