/**
 * The shapes the case editor and the server actions exchange. Deliberately plain JSON: every
 * value crosses the server-action boundary, so timestamps are ISO strings (UTC) and enums are
 * their Prisma names. `src/lib/domain/validation.ts` turns this into the validated draft.
 *
 * `stages` is the one field the database does not store: it is the editor's "which stage groups
 * are open" state, ported from the prototype's `c.stages`. On an existing case it is derived
 * from the stages of the selected reasons (see `draftFromCase`).
 */
import type {
  Answer,
  CaseManagementAction,
  CaseManagementCriteria,
  CaseManagementReferral,
  Disposition,
  InvestigationType,
  Payer,
  RoomType,
  Shift,
  UpdateAction,
} from '@prisma/client'

/** The pain-management answers (Phase 8b, decision F): Yes or No, never "Not sure". */
export type YesNo = Exclude<Answer, 'NOT_SURE'>

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
  /** Imaging only: the verbal report. A LAB row carries null (Phase 8). */
  preliminaryAt: TimeString
  resultedAt: TimeString
}

/** Everything the editor holds in state and posts back. One shape for create, save and resolve. */
export type CaseDraft = {
  mrn: string
  registrationAt: string
  shift: Shift | null
  /** Triage acuity 1..5, or null when it was not recorded (Phase 8). */
  ctas: number | null
  /** The `EdArea` the patient was assigned to, or null (Phase 8). */
  areaId: string | null
  /**
   * The one-line working diagnosis (Phase 10). A string like every other free text the editor
   * holds — blank is `''`, not null, because a controlled `<input>` cannot be given null — and
   * `caseScalarData` is what turns a blank back into a NULL column.
   */
  diagnosis: string
  /** Who pays for the visit (Phase 10), or null when it was not recorded. */
  payer: Payer | null
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
  transferRequestedAt: TimeString
  transferAcceptedAt: TimeString
  transportArrivedAt: TimeString
  referralTrackingNo: string
  transferFacility: string
  medAdminInformedAt: TimeString
  /** Pain management, Adaa KPI 8 (Phase 8b, decision F). Yes / No only. */
  painkillerPrescribed: YesNo | null
  pethidinePrescribed: YesNo | null
  /** 50, 100 or 150, and only alongside a `pethidinePrescribed` of YES. */
  pethidineDoseMg: number | null
  painkillerAt: TimeString
  sickleCellTreatment: YesNo | null
  /** Discharge communication (decision D). Yes / No / Not sure. */
  instructionsGiven: Answer | null
  familyEngagement: Answer | null
  /** Case management (decision B). */
  caseMgmtReferral: CaseManagementReferral | null
  caseMgmtCriteria: CaseManagementCriteria | null
  caseMgmtAction: CaseManagementAction | null
  caseMgmtCalledAt: TimeString
  caseMgmtRepliedAt: TimeString
  disposition: Disposition | null
  wardId: string | null
  isolation: boolean
  resolutionNote: string
  version: number
}

/**
 * One row of the append-only update list, ready to render. `action` is the weekly deck's category
 * (Phase 8b, decision C), chosen when the row was written and never afterwards.
 */
export type CaseUpdateView = {
  id: string
  createdAt: string
  text: string
  author: string
  action: UpdateAction | null
}

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
export type ReferenceArea = { id: string; code: string; name: string; retired?: boolean }
export type ReferenceData = {
  stages: ReferenceStage[]
  departments: ReferenceDepartment[]
  wards: ReferenceWard[]
  areas: ReferenceArea[]
}

// --- server action results ------------------------------------------------------------------

/** A zod issue, flattened so it survives the server-action boundary. */
export type ValidationIssue = { path: string; message: string }

export type ActionFailure =
  | { ok: false; error: 'validation'; issues: ValidationIssue[] }
  | { ok: false; error: 'conflict'; changedBy: string; changedAt: string }
  | { ok: false; error: 'forbidden' }

export type CreateCaseResult = { ok: true; id: string } | ActionFailure
/**
 * Phase 8b, decision H. No version comes back: `reviewCase` changes no case content, so it does
 * not bump the version and an open editor's draft stays valid.
 */
export type ReviewCaseResult = { ok: true; reviewedAt: string; reviewedByName: string } | ActionFailure
export type SaveCaseResult = { ok: true; version: number } | ActionFailure
export type AddUpdateResult = { ok: true; update: CaseUpdateView; warnings: string[] } | ActionFailure
export type ResolveCaseResult = { ok: true; version: number; update: CaseUpdateView } | ActionFailure
export type ReopenCaseResult = { ok: true; version: number; update: CaseUpdateView } | ActionFailure
export type VoidCaseResult = { ok: true; version: number } | ActionFailure
