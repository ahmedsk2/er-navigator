/**
 * The `before` / `after` JSON of every case audit row (locked plan section 4).
 *
 * Two properties matter and are unit-tested:
 *  1. Stable shape. The keys are written in a fixed order and the child rows are sorted by their
 *     natural key, so two snapshots of the same case are byte-identical and a diff of two audit
 *     rows shows only what a person actually changed.
 *  2. Nothing but the case. The function copies an explicit field list, so a query that happened
 *     to `include` the opener, the author of an update or the ward cannot drag a password hash
 *     or anything else into the audit table.
 */
import type {
  Answer,
  CaseManagementAction,
  CaseManagementCriteria,
  CaseManagementReferral,
  CaseStatus,
  Disposition,
  InvestigationType,
  RoomType,
  Shift,
} from '@prisma/client'

type Time = Date | null

export type SnapshotReason = { reasonId: string; otherText: string | null }
export type SnapshotConsult = {
  departmentId: string
  consultedAt: Time
  seenAt: Time
  repliedAt: Time
}
export type SnapshotInvestigation = {
  type: InvestigationType
  orderedAt: Time
  collectedAt: Time
  receivedAt: Time
  doneAt: Time
  preliminaryAt: Time
  resultedAt: Time
}

export type SnapshotSource = {
  id: string
  mrn: string
  registrationAt: Date
  openedAt: Date
  openedById: string
  shift: Shift | null
  status: CaseStatus
  primaryReasonId: string | null
  medAdminInformedAt: Time
  ctas: number | null
  areaId: string | null
  triageAt: Time
  roomAt: Time
  roomType: RoomType | null
  physicianAt: Time
  decisionAt: Time
  departedAt: Time
  admOrderAt: Time
  bedRequestedAt: Time
  bedAssignedAt: Time
  handoverAt: Time
  transferRequestedAt: Time
  transferAcceptedAt: Time
  transportArrivedAt: Time
  referralTrackingNo: string | null
  transferFacility: string | null
  // Phase 8b: the collection decisions, in the audit trail like every other column. `reviewedAt`
  // and `reviewedById` are here too, so an audit reader can see a review appear on `case.review`
  // and disappear again on the `case.update` that followed it.
  painkillerPrescribed: Answer | null
  pethidinePrescribed: Answer | null
  pethidineDoseMg: number | null
  painkillerAt: Time
  sickleCellTreatment: Answer | null
  instructionsGiven: Answer | null
  familyEngagement: Answer | null
  caseMgmtReferral: CaseManagementReferral | null
  caseMgmtCriteria: CaseManagementCriteria | null
  caseMgmtAction: CaseManagementAction | null
  caseMgmtCalledAt: Time
  caseMgmtRepliedAt: Time
  reviewedAt: Time
  reviewedById: string | null
  disposition: Disposition | null
  wardId: string | null
  isolation: boolean
  resolutionNote: string | null
  resolvedAt: Time
  voidReason: string | null
  version: number
  reasons: ReadonlyArray<SnapshotReason>
  consults: ReadonlyArray<SnapshotConsult>
  investigations: ReadonlyArray<SnapshotInvestigation>
}

const iso = (d: Time): string | null => (d ? d.toISOString() : null)
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function caseSnapshot(c: SnapshotSource): Record<string, unknown> {
  return {
    id: c.id,
    mrn: c.mrn,
    registrationAt: iso(c.registrationAt),
    openedAt: iso(c.openedAt),
    openedById: c.openedById,
    shift: c.shift,
    status: c.status,
    primaryReasonId: c.primaryReasonId,
    medAdminInformedAt: iso(c.medAdminInformedAt),
    ctas: c.ctas,
    areaId: c.areaId,
    triageAt: iso(c.triageAt),
    roomAt: iso(c.roomAt),
    roomType: c.roomType,
    physicianAt: iso(c.physicianAt),
    decisionAt: iso(c.decisionAt),
    departedAt: iso(c.departedAt),
    admOrderAt: iso(c.admOrderAt),
    bedRequestedAt: iso(c.bedRequestedAt),
    bedAssignedAt: iso(c.bedAssignedAt),
    handoverAt: iso(c.handoverAt),
    transferRequestedAt: iso(c.transferRequestedAt),
    transferAcceptedAt: iso(c.transferAcceptedAt),
    transportArrivedAt: iso(c.transportArrivedAt),
    referralTrackingNo: c.referralTrackingNo,
    transferFacility: c.transferFacility,
    painkillerPrescribed: c.painkillerPrescribed,
    pethidinePrescribed: c.pethidinePrescribed,
    pethidineDoseMg: c.pethidineDoseMg,
    painkillerAt: iso(c.painkillerAt),
    sickleCellTreatment: c.sickleCellTreatment,
    instructionsGiven: c.instructionsGiven,
    familyEngagement: c.familyEngagement,
    caseMgmtReferral: c.caseMgmtReferral,
    caseMgmtCriteria: c.caseMgmtCriteria,
    caseMgmtAction: c.caseMgmtAction,
    caseMgmtCalledAt: iso(c.caseMgmtCalledAt),
    caseMgmtRepliedAt: iso(c.caseMgmtRepliedAt),
    reviewedAt: iso(c.reviewedAt),
    reviewedById: c.reviewedById,
    disposition: c.disposition,
    wardId: c.wardId,
    isolation: c.isolation,
    resolutionNote: c.resolutionNote,
    resolvedAt: iso(c.resolvedAt),
    voidReason: c.voidReason,
    version: c.version,
    reasons: [...c.reasons]
      .sort((a, b) => byString(a.reasonId, b.reasonId))
      .map((r) => ({ reasonId: r.reasonId, otherText: r.otherText })),
    consults: [...c.consults]
      .sort((a, b) => byString(a.departmentId, b.departmentId))
      .map((x) => ({
        departmentId: x.departmentId,
        consultedAt: iso(x.consultedAt),
        seenAt: iso(x.seenAt),
        repliedAt: iso(x.repliedAt),
      })),
    investigations: [...c.investigations]
      .sort((a, b) => byString(a.type, b.type))
      .map((x) => ({
        type: x.type,
        orderedAt: iso(x.orderedAt),
        collectedAt: iso(x.collectedAt),
        receivedAt: iso(x.receivedAt),
        doneAt: iso(x.doneAt),
        preliminaryAt: iso(x.preliminaryAt),
        resultedAt: iso(x.resultedAt),
      })),
  }
}
