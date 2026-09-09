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
  primaryReason: { select: { name: true } },
  ward: { select: { code: true } },
  area: { select: { name: true } },
  // Two reads of the same relation, both cheap: the count, and the newest row's timestamp.
  // `take: 1` is a hint, not a contract — the export widens this same select to every update in
  // ascending order, so `toCaseForStats` finds the newest by scanning rather than by position.
  _count: { select: { updates: true } },
  updates: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
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

export function toCaseForStats(row: CaseStatsRow): CaseForStats {
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
  for (const u of row.updates) {
    if (!lastUpdateAt || u.createdAt.getTime() > lastUpdateAt.getTime()) lastUpdateAt = u.createdAt
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
    otherTexts: row.reasons
      .filter((r): r is typeof r & { otherText: string } => !!r.otherText && r.otherText.trim() !== '')
      .map((r) => ({ stageName: r.reason.stage.name, text: r.otherText })),
  }
}
