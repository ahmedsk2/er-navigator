/**
 * The one adapter between Prisma and the dashboard maths: the `select` the page issues, and the
 * pure function that turns those rows into `CaseForStats` (src/lib/domain/aggregates.ts).
 *
 * It exists so the aggregates never see a Prisma type and the page never sees a database shape.
 * Two things it is responsible for, both of which the aggregates assume and neither of which the
 * database gives for free:
 *
 *   - `stageNames` is DISTINCT. A case with three "Investigations" reasons is one case in the
 *     "Journey stage where delays occur" chart, not three, because `byStage()` counts one id per
 *     name it is handed. Ported from the prototype's `c.stages`, which is a set of stage ids.
 *   - `otherTexts` is the free text a nurse typed into an "Other" box, carried with the stage it
 *     was typed under, which is what the Other review queue lists.
 *
 * No `@prisma/client` value is imported — only its types — so this module stays a pure unit.
 */
import type { Prisma } from '@prisma/client'
import type { CaseForStats } from '@/src/lib/domain/aggregates'

/**
 * Exactly the columns and relations `dashboard()` reads. One query, four joins; nothing here
 * loops over cases. Voided cases are excluded by the caller's `where`, and `inRange()` drops
 * them a second time.
 */
export const CASE_STATS_SELECT = {
  id: true,
  mrn: true,
  status: true,
  registrationAt: true,
  departedAt: true,
  resolvedAt: true,
  shift: true,
  disposition: true,
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
  ctas: true,
  // Phase 8b (docs/specs/phase8b-decisions.md): the pain block, the two discharge-communication
  // answers, the case-management referral with its outcome and times, and the review.
  painkillerPrescribed: true,
  pethidinePrescribed: true,
  pethidineDoseMg: true,
  painkillerAt: true,
  sickleCellTreatment: true,
  instructionsGiven: true,
  familyEngagement: true,
  caseMgmtReferral: true,
  caseMgmtCriteria: true,
  caseMgmtAction: true,
  caseMgmtCalledAt: true,
  caseMgmtRepliedAt: true,
  reviewedAt: true,
  primaryReason: { select: { name: true } },
  ward: { select: { code: true } },
  area: { select: { name: true } },
  reviewedBy: { select: { displayName: true } },
  // The count, and every update's timestamp and action category. Phase 8b dropped the `take: 1`
  // that used to sit here: `updateActions` is the DISTINCT set of categories on the case, which
  // the newest row alone cannot answer, and Prisma has no per-parent grouped select to ask for it
  // instead. Two scalars per update row is the price; `toCaseForStats` still finds the newest by
  // scanning rather than by position, so the export's own ascending override agrees with it.
  _count: { select: { updates: true } },
  updates: { orderBy: { createdAt: 'desc' }, select: { createdAt: true, action: true } },
  reasons: {
    select: {
      otherText: true,
      reason: { select: { stage: { select: { name: true, sortOrder: true } } } },
    },
  },
  consults: {
    select: {
      consultedAt: true,
      seenAt: true,
      repliedAt: true,
      department: { select: { name: true } },
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
} as const satisfies Prisma.CaseSelect

/** The row shape `CASE_STATS_SELECT` returns, derived from the select so the two cannot drift. */
export type CaseStatsRow = Prisma.CaseGetPayload<{ select: typeof CASE_STATS_SELECT }>

/**
 * What `toCaseForStats` actually reads: `CaseStatsRow`, with `action` optional on an update row.
 *
 * One caller overrides the `updates` relation with a select of its own — `CASE_EXPORT_SELECT` in
 * src/lib/export/load.ts, which takes every update oldest-first with its text and author for the
 * Updates sheet — and it does not ask for `action`. Rather than require a column that select does
 * not have, the field is optional here and a row without it yields no kinds AND no untagged
 * count, which is the honest answer for a caller that never asked. When the export needs the
 * deck's categories (Slice H) it adds `action: true` to its own override and nothing else changes.
 */
type StatsRowInput = Omit<CaseStatsRow, 'updates'> & {
  updates: ReadonlyArray<{ createdAt: Date; action?: CaseForStats['updateActions'][number] | null }>
}

export function toCaseForStats(row: StatsRowInput): CaseForStats {
  // Stage order is the taxonomy's, so a case's stage list reads Registration → Discharge; the
  // charts re-sort by count anyway, but a stable order keeps the drill-down labels predictable.
  const stageNames = [
    ...new Set(
      [...row.reasons]
        .sort((a, b) => a.reason.stage.sortOrder - b.reason.stage.sortOrder)
        .map((r) => r.reason.stage.name),
    ),
  ]

  // Order-independent on purpose: the dashboard's select takes the newest update only, the
  // export's takes all of them oldest-first, and both must yield the same "last update at".
  let lastUpdateAt: Date | null = null
  // Phase 8b: the DISTINCT action categories on the case, in first-seen order. A Set, because the
  // deck counts a case once per category however many updates carried it — and, separately, the
  // number of updates that named no category, which a set of kinds cannot express.
  const updateActions = new Set<CaseForStats['updateActions'][number]>()
  let untaggedUpdatesCount = 0
  for (const u of row.updates) {
    if (!lastUpdateAt || u.createdAt.getTime() > lastUpdateAt.getTime()) lastUpdateAt = u.createdAt
    // A caller whose select did not ask for `action` (the export's) has no opinion on tagging, so
    // it contributes neither a kind nor an untagged update. `'action' in u` is the distinction
    // between "not asked for" and "asked for and empty"; `u.action == null` cannot see it.
    if (!('action' in u)) continue
    if (u.action) updateActions.add(u.action)
    else untaggedUpdatesCount += 1
  }

  return {
    id: row.id,
    mrn: row.mrn,
    status: row.status,
    registrationAt: row.registrationAt,
    departedAt: row.departedAt,
    resolvedAt: row.resolvedAt,
    shift: row.shift,
    primaryReasonName: row.primaryReason?.name ?? null,
    stageNames,
    // `CaseConsult` is unique per (case, department), so this list is already distinct.
    departmentNames: row.consults.map((c) => c.department.name),
    disposition: row.disposition,
    consults: row.consults.map((c) => ({
      departmentName: c.department.name,
      consultedAt: c.consultedAt,
      seenAt: c.seenAt,
      repliedAt: c.repliedAt,
    })),
    investigations: row.investigations.map((i) => ({
      type: i.type,
      orderedAt: i.orderedAt,
      collectedAt: i.collectedAt,
      receivedAt: i.receivedAt,
      doneAt: i.doneAt,
      preliminaryAt: i.preliminaryAt,
      resultedAt: i.resultedAt,
    })),
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
    wardCode: row.ward?.code ?? null,
    ctas: row.ctas,
    areaName: row.area?.name ?? null,
    updatesCount: row._count.updates,
    lastUpdateAt,
    painkillerPrescribed: row.painkillerPrescribed,
    pethidinePrescribed: row.pethidinePrescribed,
    pethidineDoseMg: row.pethidineDoseMg,
    painkillerAt: row.painkillerAt,
    sickleCellTreatment: row.sickleCellTreatment,
    instructionsGiven: row.instructionsGiven,
    familyEngagement: row.familyEngagement,
    caseMgmtReferral: row.caseMgmtReferral,
    caseMgmtCriteria: row.caseMgmtCriteria,
    caseMgmtAction: row.caseMgmtAction,
    caseMgmtCalledAt: row.caseMgmtCalledAt,
    caseMgmtRepliedAt: row.caseMgmtRepliedAt,
    reviewedAt: row.reviewedAt,
    // The reviewer's name, not their id: `kpi.ts` reads it to print "Reviewed by …" and never
    // needs to look a user up.
    reviewedByName: row.reviewedBy?.displayName ?? null,
    updateActions: [...updateActions],
    untaggedUpdatesCount,
    otherTexts: row.reasons
      .filter((r): r is typeof r & { otherText: string } => !!r.otherText && r.otherText.trim() !== '')
      .map((r) => ({ stageName: r.reason.stage.name, text: r.otherText })),
  }
}
