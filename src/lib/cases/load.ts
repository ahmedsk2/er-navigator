/**
 * Reading a case for the editor: the stored row and its children turned into the plain JSON draft
 * the client component holds in state, plus the append-only update list.
 *
 * `stages` is reconstructed here — the database stores reasons, and the editor's stage chips are
 * "the stages of the reasons you picked" (the prototype's `c.stages`).
 */
import type { Answer, CaseStatus } from '@prisma/client'
import { prisma } from '@/src/lib/db'
import { REGISTRATION_DEFAULT_HOURS_AGO } from '@/src/lib/domain/validation'
import { stageOfReason } from './reference'
import { timelineOf, type TimelineStepView } from './timeline'
import type { CaseDraft, CaseUpdateView, ReferenceData, YesNo } from './types'

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** A stored `Answer` as the two-valued answer the pain-management questions take. */
const yesNo = (v: Answer | null): YesNo | null => (v === 'YES' || v === 'NO' ? v : null)

export type LoadedCase = {
  id: string
  status: CaseStatus
  voidReason: string | null
  openedByName: string
  openedAt: string
  draft: CaseDraft
  updates: CaseUpdateView[]
  /**
   * The supervisor review (Phase 8b, decision H), or null. It is not part of the draft: nothing
   * the editor posts back can set or clear it, and it is displayed to every role while only a
   * SUPERVISOR or an ADMIN is offered the control.
   */
  review: { at: string; byName: string } | null
  /**
   * Every recorded instant on the case in order, for the read-only Timeline section (Phase 8).
   * Built from the row this function already loaded rather than by a second query, and the
   * consulted team's name comes from the reference the caller passed in — the same list the
   * editor's chips are drawn from, so a retired department still reads by name.
   */
  timeline: TimelineStepView[]
}

/** A new case: registration defaults to six hours ago, shift to the navigator's last shift. */
export function blankDraft(input: { now: Date; shift: CaseDraft['shift'] }): CaseDraft {
  const registrationAt = new Date(input.now.getTime() - REGISTRATION_DEFAULT_HOURS_AGO * 36e5)
  return {
    mrn: '',
    registrationAt: registrationAt.toISOString(),
    shift: input.shift,
    ctas: null,
    areaId: null,
    diagnosis: '',
    payer: null,
    stages: [],
    reasons: [],
    primaryReasonId: null,
    consults: [],
    investigations: [],
    roomType: null,
    triageAt: null,
    roomAt: null,
    physicianAt: null,
    decisionAt: null,
    departedAt: null,
    admOrderAt: null,
    bedRequestedAt: null,
    bedAssignedAt: null,
    handoverAt: null,
    transferRequestedAt: null,
    transferAcceptedAt: null,
    transportArrivedAt: null,
    referralTrackingNo: '',
    transferFacility: '',
    medAdminInformedAt: null,
    painkillerPrescribed: null,
    pethidinePrescribed: null,
    pethidineDoseMg: null,
    painkillerAt: null,
    sickleCellTreatment: null,
    instructionsGiven: null,
    familyEngagement: null,
    caseMgmtReferral: null,
    caseMgmtCriteria: null,
    caseMgmtAction: null,
    caseMgmtCalledAt: null,
    caseMgmtRepliedAt: null,
    disposition: null,
    wardId: null,
    isolation: false,
    resolutionNote: '',
    version: 1,
  }
}

type CaseRow = {
  mrn: string
  registrationAt: Date
  shift: CaseDraft['shift']
  ctas: number | null
  areaId: string | null
  diagnosis: string | null
  payer: CaseDraft['payer']
  primaryReasonId: string | null
  roomType: CaseDraft['roomType']
  triageAt: Date | null
  roomAt: Date | null
  physicianAt: Date | null
  decisionAt: Date | null
  departedAt: Date | null
  admOrderAt: Date | null
  bedRequestedAt: Date | null
  bedAssignedAt: Date | null
  handoverAt: Date | null
  transferRequestedAt: Date | null
  transferAcceptedAt: Date | null
  transportArrivedAt: Date | null
  referralTrackingNo: string | null
  transferFacility: string | null
  medAdminInformedAt: Date | null
  // The three pain-management columns are `Answer?` in the database because they share the enum,
  // but the app only ever writes YES or NO (zod refuses NOT_SURE there). `yesNo` below reads a
  // stray NOT_SURE — which only a hand-written UPDATE could produce — as "not recorded".
  painkillerPrescribed: Answer | null
  pethidinePrescribed: Answer | null
  pethidineDoseMg: number | null
  painkillerAt: Date | null
  sickleCellTreatment: Answer | null
  instructionsGiven: CaseDraft['instructionsGiven']
  familyEngagement: CaseDraft['familyEngagement']
  caseMgmtReferral: CaseDraft['caseMgmtReferral']
  caseMgmtCriteria: CaseDraft['caseMgmtCriteria']
  caseMgmtAction: CaseDraft['caseMgmtAction']
  caseMgmtCalledAt: Date | null
  caseMgmtRepliedAt: Date | null
  disposition: CaseDraft['disposition']
  wardId: string | null
  isolation: boolean
  resolutionNote: string | null
  version: number
  reasons: ReadonlyArray<{ reasonId: string; otherText: string | null }>
  consults: ReadonlyArray<{
    departmentId: string
    consultedAt: Date | null
    seenAt: Date | null
    repliedAt: Date | null
  }>
  investigations: ReadonlyArray<{
    type: CaseDraft['investigations'][number]['type']
    orderedAt: Date | null
    collectedAt: Date | null
    receivedAt: Date | null
    doneAt: Date | null
    preliminaryAt: Date | null
    resultedAt: Date | null
  }>
}

export function draftFromCase(row: CaseRow, reference: ReferenceData): CaseDraft {
  const owner = stageOfReason(reference)
  const order = new Map(reference.stages.map((s, i) => [s.id, i]))
  const stages = [...new Set(row.reasons.map((r) => owner.get(r.reasonId)?.id).filter((id): id is string => !!id))]
  stages.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))

  return {
    mrn: row.mrn,
    registrationAt: row.registrationAt.toISOString(),
    shift: row.shift,
    ctas: row.ctas,
    areaId: row.areaId,
    // Phase 10: a NULL diagnosis becomes the empty string the controlled input needs, the same
    // way the resolution note and the referral number do.
    diagnosis: row.diagnosis ?? '',
    payer: row.payer,
    stages,
    reasons: row.reasons.map((r) => ({ reasonId: r.reasonId, otherText: r.otherText })),
    primaryReasonId: row.primaryReasonId,
    consults: row.consults.map((c) => ({
      departmentId: c.departmentId,
      consultedAt: iso(c.consultedAt),
      seenAt: iso(c.seenAt),
      repliedAt: iso(c.repliedAt),
    })),
    investigations: row.investigations.map((i) => ({
      type: i.type,
      orderedAt: iso(i.orderedAt),
      collectedAt: iso(i.collectedAt),
      receivedAt: iso(i.receivedAt),
      doneAt: iso(i.doneAt),
      preliminaryAt: iso(i.preliminaryAt),
      resultedAt: iso(i.resultedAt),
    })),
    roomType: row.roomType,
    triageAt: iso(row.triageAt),
    roomAt: iso(row.roomAt),
    physicianAt: iso(row.physicianAt),
    decisionAt: iso(row.decisionAt),
    departedAt: iso(row.departedAt),
    admOrderAt: iso(row.admOrderAt),
    bedRequestedAt: iso(row.bedRequestedAt),
    bedAssignedAt: iso(row.bedAssignedAt),
    handoverAt: iso(row.handoverAt),
    transferRequestedAt: iso(row.transferRequestedAt),
    transferAcceptedAt: iso(row.transferAcceptedAt),
    transportArrivedAt: iso(row.transportArrivedAt),
    referralTrackingNo: row.referralTrackingNo ?? '',
    transferFacility: row.transferFacility ?? '',
    medAdminInformedAt: iso(row.medAdminInformedAt),
    painkillerPrescribed: yesNo(row.painkillerPrescribed),
    pethidinePrescribed: yesNo(row.pethidinePrescribed),
    pethidineDoseMg: row.pethidineDoseMg,
    painkillerAt: iso(row.painkillerAt),
    sickleCellTreatment: yesNo(row.sickleCellTreatment),
    instructionsGiven: row.instructionsGiven,
    familyEngagement: row.familyEngagement,
    caseMgmtReferral: row.caseMgmtReferral,
    caseMgmtCriteria: row.caseMgmtCriteria,
    caseMgmtAction: row.caseMgmtAction,
    caseMgmtCalledAt: iso(row.caseMgmtCalledAt),
    caseMgmtRepliedAt: iso(row.caseMgmtRepliedAt),
    disposition: row.disposition,
    wardId: row.wardId,
    isolation: row.isolation,
    resolutionNote: row.resolutionNote ?? '',
    version: row.version,
  }
}

export async function loadCaseForEditor(id: string, reference: ReferenceData): Promise<LoadedCase | null> {
  const row = await prisma.case.findUnique({
    where: { id },
    include: {
      reasons: true,
      consults: true,
      investigations: true,
      openedBy: { select: { displayName: true } },
      reviewedBy: { select: { displayName: true } },
      updates: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, text: true, action: true, author: { select: { displayName: true } } },
      },
    },
  })
  if (!row) return null

  const departmentName = new Map(reference.departments.map((d) => [d.id, d.name]))

  return {
    id: row.id,
    status: row.status,
    voidReason: row.voidReason,
    openedByName: row.openedBy.displayName,
    openedAt: row.openedAt.toISOString(),
    draft: draftFromCase(row, reference),
    updates: row.updates.map((u) => ({
      id: u.id,
      createdAt: u.createdAt.toISOString(),
      text: u.text,
      author: u.author.displayName,
      action: u.action,
    })),
    // Both halves or nothing: a review row without its reviewer would render "Reviewed by ,".
    review:
      row.reviewedAt && row.reviewedBy
        ? { at: row.reviewedAt.toISOString(), byName: row.reviewedBy.displayName }
        : null,
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
        departmentName: departmentName.get(consult.departmentId) ?? consult.departmentId,
        consultedAt: consult.consultedAt,
        seenAt: consult.seenAt,
        repliedAt: consult.repliedAt,
      })),
      investigations: row.investigations,
    }),
  }
}
