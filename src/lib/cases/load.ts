/**
 * Reading a case for the editor: the stored row and its children turned into the plain JSON draft
 * the client component holds in state, plus the append-only update list.
 *
 * `stages` is reconstructed here — the database stores reasons, and the editor's stage chips are
 * "the stages of the reasons you picked" (the prototype's `c.stages`).
 */
import type { CaseStatus } from '@prisma/client'
import { prisma } from '@/src/lib/db'
import { REGISTRATION_DEFAULT_HOURS_AGO } from '@/src/lib/domain/validation'
import { stageOfReason } from './reference'
import type { CaseDraft, CaseUpdateView, ReferenceData } from './types'

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export type LoadedCase = {
  id: string
  status: CaseStatus
  voidReason: string | null
  openedByName: string
  openedAt: string
  draft: CaseDraft
  updates: CaseUpdateView[]
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
      updates: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, text: true, author: { select: { displayName: true } } },
      },
    },
  })
  if (!row) return null

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
    })),
  }
}
