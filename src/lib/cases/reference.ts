/**
 * Reference data for the case editor: the active stages with their reasons, the active
 * departments and the active wards, read once per request and handed both to the editor (for the
 * chips) and to `buildCaseSchemas()` (for the rules that depend on reason metadata).
 *
 * The database is the source of truth — from Phase 6 an Admin renames, reorders and deactivates
 * these rows — so nothing here reads `src/lib/domain/taxonomy.ts`, which only seeds an empty
 * database and drives the unit tests.
 *
 * `cache()` de-duplicates the three queries across the layout, the page and any server action in
 * the same request; outside a React request scope (the database-backed tests) it simply calls
 * through.
 *
 * `loadReference()` is the strict, active-only list — the one `/cases/new` and `createCase` use.
 * `loadReferenceForCase(id)` adds the rows that case already carries even if an Admin has since
 * deactivated them; see its own note.
 */
import { cache } from 'react'
import { prisma } from '@/src/lib/db'
import { buildCaseSchemas, type ReasonMeta } from '@/src/lib/domain/validation'
import type { ReferenceData } from './types'

export const loadReference = cache(async (): Promise<ReferenceData> => {
  const [stages, departments, wards] = await Promise.all([
    prisma.stage.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        reasons: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, requiresDepartment: true, requiresReferralNo: true, isOther: true },
        },
      },
    }),
    prisma.department.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.ward.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  ])
  return { stages, departments, wards }
})

/**
 * The reference for an existing case: the active rows PLUS any deactivated row this case already
 * carries — the reasons on its `CaseReason` rows, the departments on its consults and its ward —
 * each flagged `retired: true` (Phase 7, C4/C10).
 *
 * Without this, deactivating a reference row in Admin froze every case that carried it: the id
 * survived in the draft, the chips (active-only) offered nothing to deselect it with, and both
 * `saveCase` and `resolveCase` refused the row it could not be removed from. The union keeps the
 * stored value visible and removable, and makes the rules accept it — but only on the case that
 * already has it, so a nurse still cannot add a retired reason to a new case.
 */
export const loadReferenceForCase = cache(async (caseId: string): Promise<ReferenceData> => {
  const [active, row] = await Promise.all([
    loadReference(),
    prisma.case.findUnique({
      where: { id: caseId },
      select: {
        wardId: true,
        reasons: { select: { reasonId: true } },
        consults: { select: { departmentId: true } },
      },
    }),
  ])
  if (!row) return active

  const knownReasons = new Set(active.stages.flatMap((s) => s.reasons.map((r) => r.id)))
  const missingReasons = [...new Set(row.reasons.map((r) => r.reasonId))].filter((id) => !knownReasons.has(id))
  const knownDepartments = new Set(active.departments.map((d) => d.id))
  const missingDepartments = [...new Set(row.consults.map((c) => c.departmentId))].filter(
    (id) => !knownDepartments.has(id),
  )
  const missingWard = row.wardId && !active.wards.some((w) => w.id === row.wardId) ? row.wardId : null
  if (missingReasons.length === 0 && missingDepartments.length === 0 && !missingWard) return active

  const [reasons, departments, ward] = await Promise.all([
    missingReasons.length > 0
      ? prisma.reason.findMany({
          where: { id: { in: missingReasons } },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            stageId: true,
            name: true,
            requiresDepartment: true,
            requiresReferralNo: true,
            isOther: true,
          },
        })
      : [],
    missingDepartments.length > 0
      ? prisma.department.findMany({
          where: { id: { in: missingDepartments } },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true },
        })
      : [],
    missingWard ? prisma.ward.findUnique({ where: { id: missingWard }, select: { id: true, code: true, name: true } }) : null,
  ])

  // A retired reason joins its own stage, at the end of that stage's list. Stages are fixed —
  // Admin has no path that deactivates one — so a stage lookup that misses means the row is
  // genuinely unknown and is left out, which the rules then reject as they always did.
  const stages = active.stages.map((stage) => {
    const mine = reasons.filter((r) => r.stageId === stage.id)
    if (mine.length === 0) return stage
    return {
      ...stage,
      reasons: [
        ...stage.reasons,
        ...mine.map((r) => ({
          id: r.id,
          name: r.name,
          requiresDepartment: r.requiresDepartment,
          requiresReferralNo: r.requiresReferralNo,
          isOther: r.isOther,
          retired: true,
        })),
      ],
    }
  })

  return {
    stages,
    departments: [...active.departments, ...departments.map((d) => ({ id: d.id, name: d.name, retired: true }))],
    wards: [...active.wards, ...(ward ? [{ id: ward.id, code: ward.code, name: ward.name, retired: true }] : [])],
  }
})

/** reasonId -> the three flags the validation factory needs. */
export function reasonMetaOf(reference: ReferenceData): Map<string, ReasonMeta> {
  const meta = new Map<string, ReasonMeta>()
  for (const stage of reference.stages) {
    for (const reason of stage.reasons) {
      meta.set(reason.id, {
        requiresDepartment: reason.requiresDepartment,
        requiresReferralNo: reason.requiresReferralNo,
        isOther: reason.isOther,
      })
    }
  }
  return meta
}

/** The `draft` and `resolve` schemas for this request's reference data. */
export function caseSchemas(reference: ReferenceData) {
  return buildCaseSchemas(reasonMetaOf(reference))
}

/** reasonId -> the stage that owns it, for the "Other" review queue and the warning labels. */
export function stageOfReason(reference: ReferenceData): Map<string, { id: string; code: string; name: string }> {
  const owner = new Map<string, { id: string; code: string; name: string }>()
  for (const stage of reference.stages) {
    for (const reason of stage.reasons) {
      owner.set(reason.id, { id: stage.id, code: stage.code, name: stage.name })
    }
  }
  return owner
}

export function departmentNames(reference: ReferenceData): Map<string, string> {
  return new Map(reference.departments.map((d) => [d.id, d.name]))
}
