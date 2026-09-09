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
