/**
 * Reading the cases an export covers. One `findMany` per request, with the dashboard's own select
 * widened by the columns only the workbook shows, so the sheet and the Summary can never disagree
 * about what a case is: `toCaseForExport` builds on `toCaseForStats`, it does not re-derive it.
 *
 * Voided cases are excluded by the status whitelist, and the range is the half-open Riyadh-day
 * window from `riyadhDayBounds` — see src/lib/export/range.ts for why the server's own UTC day is
 * the wrong unit here.
 */
import type { Prisma } from '@prisma/client'
import { CASE_STATS_SELECT, toCaseForStats } from '@/src/lib/cases/stats-mapper'
import { prisma } from '@/src/lib/db'
import type { CaseForStats } from '@/src/lib/domain/aggregates'
import { EXPORT_STATUS_VALUES, riyadhDayBounds, type ExportRange } from './range'
import type { CaseForExport } from './rows'

/** The dashboard's columns plus the sheet's. `openedBy`/`author` give up the display name only. */
export const CASE_EXPORT_SELECT = {
  ...CASE_STATS_SELECT,
  primaryReason: { select: { name: true, stage: { select: { name: true } } } },
  reasons: {
    select: {
      otherText: true,
      reason: { select: { name: true, stage: { select: { name: true, sortOrder: true } } } },
    },
  },
  openedBy: { select: { displayName: true, username: true } },
  referralTrackingNo: true,
  transferFacility: true,
  isolation: true,
  resolutionNote: true,
  // Widens the dashboard's `take: 1` newest-first read to the whole list, oldest first, which is
  // the order the Updates sheet prints. `toCaseForStats` finds the newest by scanning, so both
  // shapes agree on `lastUpdateAt`.
  updates: {
    select: { createdAt: true, text: true, author: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.CaseSelect

export type CaseExportRow = Prisma.CaseGetPayload<{ select: typeof CASE_EXPORT_SELECT }>

const label = (r: { name: string; stage: { name: string } }): string => `${r.stage.name}: ${r.name}`

export function toCaseForExport(row: CaseExportRow): CaseForExport {
  // Taxonomy order, the same order `stageNames` is built in, so the two columns read together.
  const reasons = [...row.reasons].sort(
    (a, b) => a.reason.stage.sortOrder - b.reason.stage.sortOrder || a.reason.name.localeCompare(b.reason.name),
  )
  return {
    ...toCaseForStats(row),
    navigatorName: row.openedBy.displayName,
    navigatorUsername: row.openedBy.username,
    primaryReasonLabel: row.primaryReason ? label(row.primaryReason) : null,
    reasonLabels: reasons.map((r) => label(r.reason)),
    reasonRows: reasons.map((r) => ({ stageName: r.reason.stage.name, reasonName: r.reason.name })),
    referralTrackingNo: row.referralTrackingNo,
    transferFacility: row.transferFacility,
    isolation: row.isolation,
    resolutionNote: row.resolutionNote,
    updates: row.updates.map((u) => ({
      at: u.createdAt,
      text: u.text,
      authorName: u.author.displayName,
    })),
  }
}

export function exportWhere(range: ExportRange): Prisma.CaseWhereInput {
  const { gte, lt } = riyadhDayBounds(range.from, range.to)
  return {
    status: { in: [...EXPORT_STATUS_VALUES[range.status]] },
    registrationAt: { gte, lt },
  }
}

const ORDER: Prisma.CaseOrderByWithRelationInput[] = [{ registrationAt: 'asc' }, { id: 'asc' }]

export async function countCasesForExport(range: ExportRange): Promise<number> {
  return prisma.case.count({ where: exportWhere(range) })
}

export async function loadCasesForExport(range: ExportRange): Promise<CaseForExport[]> {
  const rows = await prisma.case.findMany({
    where: exportWhere(range),
    orderBy: ORDER,
    select: CASE_EXPORT_SELECT,
  })
  return rows.map(toCaseForExport)
}

/** The printed report needs the dashboard maths over the same window, and nothing else. */
export async function loadCasesForStatsInRange(range: ExportRange): Promise<CaseForStats[]> {
  const rows = await prisma.case.findMany({
    where: exportWhere(range),
    orderBy: ORDER,
    select: CASE_STATS_SELECT,
  })
  return rows.map(toCaseForStats)
}
