/**
 * The shapes the case editor and the server actions exchange. Deliberately plain JSON: every
 * value crosses the server-action boundary, so timestamps are ISO strings (UTC) and enums are
 * their Prisma names. `src/lib/domain/validation.ts` turns this into the validated draft.
 *
 * `stages` is the one field the database does not store: it is the editor's "which stage groups
 * are open" state, ported from the prototype's `c.stages`. On an existing case it is derived
 * from the stages of the selected reasons (see `draftFromCase`).
 */
import type { Disposition, InvestigationType, RoomType, Shift } from '@prisma/client'

/** An ISO-8601 UTC instant, or null for "not recorded". */
export type TimeString = string | null

export type DraftReason = { reasonId: string; otherText: string | null }

export type DraftConsult = {
  departmentId: string
  consultedAt: TimeString
  seenAt: TimeString
  repliedAt: TimeString
}

export type DraftInvestigation = {
  type: InvestigationType
  orderedAt: TimeString
  collectedAt: TimeString
  receivedAt: TimeString
  doneAt: TimeString
  resultedAt: TimeString
}

/** Everything the editor holds in state and posts back. One shape for create, save and resolve. */
export type CaseDraft = {
  mrn: string
  registrationAt: string
  shift: Shift | null
  stages: string[]
  reasons: DraftReason[]
  primaryReasonId: string | null
  consults: DraftConsult[]
  investigations: DraftInvestigation[]
  roomType: RoomType | null
  triageAt: TimeString
  roomAt: TimeString
  physicianAt: TimeString
  decisionAt: TimeString
  departedAt: TimeString
  admOrderAt: TimeString
  bedRequestedAt: TimeString
  bedAssignedAt: TimeString
  handoverAt: TimeString
  transferRequestedAt: TimeString
  transferAcceptedAt: TimeString
  transportArrivedAt: TimeString
  referralTrackingNo: string
  transferFacility: string
  medAdminInformedAt: TimeString
  disposition: Disposition | null
  wardId: string | null
  isolation: boolean
  resolutionNote: string
  version: number
}

/** One row of the append-only update list, ready to render. */
export type CaseUpdateView = { id: string; createdAt: string; text: string; author: string }

/**
 * Reference lists, loaded once per request and handed to the editor.
 *
 * `retired` marks a row an Admin has deactivated that the case being edited already carries
 * (`loadReferenceForCase`). It is absent on the active-only reference `/cases/new` uses. A
 * retired row is accepted by the rules and rendered as a chip that can only be deselected, so a
 * deactivation never strands an open case (Phase 7, C4/C10).
 */
export type ReferenceReason = {
  id: string
  name: string
  requiresDepartment: boolean
  requiresReferralNo: boolean
  isOther: boolean
  retired?: boolean
}
export type ReferenceStage = { id: string; code: string; name: string; reasons: ReferenceReason[] }
export type ReferenceDepartment = { id: string; name: string; retired?: boolean }
export type ReferenceWard = { id: string; code: string; name: string; retired?: boolean }
export type ReferenceData = {
  stages: ReferenceStage[]
  departments: ReferenceDepartment[]
  wards: ReferenceWard[]
}

// --- server action results ------------------------------------------------------------------

/** A zod issue, flattened so it survives the server-action boundary. */
export type ValidationIssue = { path: string; message: string }

export type ActionFailure =
  | { ok: false; error: 'validation'; issues: ValidationIssue[] }
  | { ok: false; error: 'conflict'; changedBy: string; changedAt: string }
  | { ok: false; error: 'forbidden' }

export type CreateCaseResult = { ok: true; id: string } | ActionFailure
export type SaveCaseResult = { ok: true; version: number } | ActionFailure
export type AddUpdateResult = { ok: true; update: CaseUpdateView; warnings: string[] } | ActionFailure
export type ResolveCaseResult = { ok: true; version: number; update: CaseUpdateView } | ActionFailure
export type ReopenCaseResult = { ok: true; version: number; update: CaseUpdateView } | ActionFailure
export type VoidCaseResult = { ok: true; version: number } | ActionFailure
