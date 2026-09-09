/**
 * Admin → Reference lists: departments, wards, ED areas, and the reasons under each stage. Add,
 * rename, deactivate/reactivate, reorder. Stages themselves are fixed (Phase 6 spec, "Do not").
 *
 * Renaming keeps the id, so every case already tagged with that reason stays tagged: the row is
 * updated, never replaced. Nothing is deleted — a list entry is deactivated, which hides it from
 * the case editor's chips while the cases that already carry it keep rendering it. The seed is
 * insert-if-missing and only ever fills an empty table, so none of this is undone by a deploy.
 *
 * Every change is one `list.update` audit row carrying before and after.
 */
import { z } from 'zod'
import { audit, type AuditContext } from '@/src/lib/audit'
import { assertCan, type AuthUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'
import { inDisplayOrder, nextSortOrder, planMove, type Direction } from './reorder'
import { fail, type AdminFailure } from './types'

/** `area` is Phase 8's `EdArea`; it behaves exactly as `ward` does, code and all. */
export type ListKind = 'department' | 'ward' | 'area' | 'reason'

/** The two kinds whose natural key is a short code as well as a name. */
const CODED_KINDS = new Set<ListKind>(['ward', 'area'])

export type ListItem = {
  id: string
  name: string
  /** Wards and ED areas have a code; departments and reasons do not. */
  code: string | null
  active: boolean
  sortOrder: number
  /** True for the one "Other" reason each stage has: it may be reordered, never renamed away. */
  isOther: boolean
}

export type StageLists = { id: string; code: string; name: string; reasons: ListItem[] }

export type ReferenceLists = {
  departments: ListItem[]
  wards: ListItem[]
  areas: ListItem[]
  stages: StageLists[]
}

const nameSchema = z.string().trim().min(2, 'Give it a name of at least two characters.').max(120)
const codeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9-]{2,12}$/.test(v), { message: 'Use 2 to 12 letters, digits or dashes.' })

const kindSchema = z.enum(['department', 'ward', 'area', 'reason'])
const directionSchema = z.enum(['up', 'down'])

export async function loadReferenceLists(): Promise<ReferenceLists> {
  const [departments, wards, areas, stages] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true, active: true, sortOrder: true } }),
    prisma.ward.findMany({ select: { id: true, code: true, name: true, active: true, sortOrder: true } }),
    prisma.edArea.findMany({ select: { id: true, code: true, name: true, active: true, sortOrder: true } }),
    prisma.stage.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        reasons: {
          select: { id: true, name: true, active: true, sortOrder: true, isOther: true },
        },
      },
    }),
  ])

  return {
    departments: inDisplayOrder(departments).map((d) => ({ ...d, code: null, isOther: false })),
    wards: inDisplayOrder(wards).map((w) => ({ ...w, isOther: false })),
    areas: inDisplayOrder(areas).map((a) => ({ ...a, isOther: false })),
    stages: stages.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      reasons: inDisplayOrder(s.reasons).map((r) => ({ ...r, code: null })),
    })),
  }
}

type Existing = { id: string; name: string; active: boolean; sortOrder: number; isOther?: boolean }

async function itemsOf(kind: ListKind, stageId: string | null): Promise<Existing[]> {
  if (kind === 'department') {
    return prisma.department.findMany({ select: { id: true, name: true, active: true, sortOrder: true } })
  }
  if (kind === 'ward') {
    return prisma.ward.findMany({ select: { id: true, name: true, active: true, sortOrder: true } })
  }
  if (kind === 'area') {
    return prisma.edArea.findMany({ select: { id: true, name: true, active: true, sortOrder: true } })
  }
  return prisma.reason.findMany({
    where: stageId ? { stageId } : undefined,
    select: { id: true, name: true, active: true, sortOrder: true, isOther: true },
  })
}

async function findItem(
  kind: ListKind,
  id: string,
): Promise<(Existing & { stageId?: string; code?: string }) | null> {
  if (kind === 'department') {
    return prisma.department.findUnique({
      where: { id },
      select: { id: true, name: true, active: true, sortOrder: true },
    })
  }
  if (kind === 'ward') {
    return prisma.ward.findUnique({
      where: { id },
      select: { id: true, name: true, active: true, sortOrder: true, code: true },
    })
  }
  if (kind === 'area') {
    return prisma.edArea.findUnique({
      where: { id },
      select: { id: true, name: true, active: true, sortOrder: true, code: true },
    })
  }
  return prisma.reason.findUnique({
    where: { id },
    select: { id: true, name: true, active: true, sortOrder: true, isOther: true, stageId: true },
  })
}

const LABEL: Record<ListKind, string> = {
  department: 'department',
  ward: 'ward',
  area: 'ED area',
  reason: 'reason',
}

const ENTITY: Record<ListKind, string> = {
  department: 'Department',
  ward: 'Ward',
  area: 'EdArea',
  reason: 'Reason',
}

async function writeAudit(
  ctx: AuditContext,
  kind: ListKind,
  id: string,
  before: unknown,
  after: unknown,
  tx: Parameters<typeof audit>[2],
): Promise<void> {
  await audit({ action: 'list.update', entity: ENTITY[kind], entityId: id, before, after }, ctx, tx)
}

// --- add ---------------------------------------------------------------------------------------

const addSchema = z.object({
  kind: kindSchema,
  name: nameSchema,
  stageId: z.string().min(1).nullable().optional(),
  code: z.string().nullable().optional(),
})

export type ListResult = { ok: true; id: string } | AdminFailure

export async function addListItem(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<ListResult> {
  await assertCan(actor, 'admin.lists', ctx)
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) {
    return fail('validation', parsed.error.issues[0]?.message ?? 'Check the details and try again.')
  }
  const { kind, name } = parsed.data
  const stageId = parsed.data.stageId ?? null

  if (kind === 'reason' && !stageId) return fail('validation', 'Pick the stage the reason belongs to.')

  const siblings = await itemsOf(kind, stageId)
  if (siblings.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
    return fail('duplicate', `"${name}" is already on that list.`)
  }
  const sortOrder = nextSortOrder(siblings)

  let code: string | null = null
  if (CODED_KINDS.has(kind)) {
    const parsedCode = codeSchema.safeParse(parsed.data.code ?? '')
    if (!parsedCode.success) {
      return fail('validation', parsedCode.error.issues[0]?.message ?? `Give the ${LABEL[kind]} a short code.`)
    }
    code = parsedCode.data
    const clash =
      kind === 'ward'
        ? await prisma.ward.findUnique({ where: { code }, select: { id: true } })
        : await prisma.edArea.findUnique({ where: { code }, select: { id: true } })
    if (clash) return fail('duplicate', `The ${LABEL[kind]} code "${code}" is already used.`)
  }

  const id = await prisma.$transaction(async (tx) => {
    const created =
      kind === 'department'
        ? await tx.department.create({ data: { name, sortOrder }, select: { id: true } })
        : kind === 'ward'
          ? await tx.ward.create({ data: { name, code: code!, sortOrder }, select: { id: true } })
          : kind === 'area'
            ? await tx.edArea.create({ data: { name, code: code!, sortOrder }, select: { id: true } })
            : await tx.reason.create({
                data: { name, sortOrder, stageId: stageId!, isOther: false },
                select: { id: true },
              })
    await writeAudit(ctx, kind, created.id, null, { name, code, sortOrder, stageId, active: true }, tx)
    return created.id
  })

  return { ok: true, id }
}

// --- rename ------------------------------------------------------------------------------------

const renameSchema = z.object({ kind: kindSchema, id: z.string().min(1), name: nameSchema })

export async function renameListItem(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<ListResult> {
  await assertCan(actor, 'admin.lists', ctx)
  const parsed = renameSchema.safeParse(input)
  if (!parsed.success) {
    return fail('validation', parsed.error.issues[0]?.message ?? 'Check the name and try again.')
  }
  const { kind, id, name } = parsed.data

  const item = await findItem(kind, id)
  if (!item) return fail('missing', `That ${LABEL[kind]} no longer exists.`)
  if (item.isOther) return fail('validation', 'The "Other" entry of a stage cannot be renamed.')
  if (item.name === name) return { ok: true, id }

  const siblings = await itemsOf(kind, item.stageId ?? null)
  if (siblings.some((i) => i.id !== id && i.name.toLowerCase() === name.toLowerCase())) {
    return fail('duplicate', `"${name}" is already on that list.`)
  }

  await prisma.$transaction(async (tx) => {
    if (kind === 'department') await tx.department.update({ where: { id }, data: { name } })
    else if (kind === 'ward') await tx.ward.update({ where: { id }, data: { name } })
    else if (kind === 'area') await tx.edArea.update({ where: { id }, data: { name } })
    else await tx.reason.update({ where: { id }, data: { name } })
    await writeAudit(ctx, kind, id, { name: item.name }, { name }, tx)
  })

  return { ok: true, id }
}

// --- activate / deactivate ---------------------------------------------------------------------

const activeSchema = z.object({ kind: kindSchema, id: z.string().min(1), active: z.boolean() })

export async function setListItemActive(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<ListResult> {
  await assertCan(actor, 'admin.lists', ctx)
  const parsed = activeSchema.safeParse(input)
  if (!parsed.success) return fail('validation', 'Check the details and try again.')
  const { kind, id, active } = parsed.data

  const item = await findItem(kind, id)
  if (!item) return fail('missing', `That ${LABEL[kind]} no longer exists.`)
  if (item.isOther && !active) {
    return fail('validation', 'Every stage keeps its "Other" entry: that is how new reasons reach the queue.')
  }
  if (item.active === active) return { ok: true, id }

  await prisma.$transaction(async (tx) => {
    if (kind === 'department') await tx.department.update({ where: { id }, data: { active } })
    else if (kind === 'ward') await tx.ward.update({ where: { id }, data: { active } })
    else if (kind === 'area') await tx.edArea.update({ where: { id }, data: { active } })
    else await tx.reason.update({ where: { id }, data: { active } })
    await writeAudit(ctx, kind, id, { name: item.name, active: item.active }, { name: item.name, active }, tx)
  })

  return { ok: true, id }
}

// --- reorder -----------------------------------------------------------------------------------

const moveSchema = z.object({
  kind: kindSchema,
  id: z.string().min(1),
  direction: directionSchema,
})

export async function moveListItem(
  actor: AuthUser,
  input: unknown,
  ctx: AuditContext,
): Promise<ListResult> {
  await assertCan(actor, 'admin.lists', ctx)
  const parsed = moveSchema.safeParse(input)
  if (!parsed.success) return fail('validation', 'Check the details and try again.')
  const { kind, id } = parsed.data
  const direction: Direction = parsed.data.direction

  const item = await findItem(kind, id)
  if (!item) return fail('missing', `That ${LABEL[kind]} no longer exists.`)

  const siblings = await itemsOf(kind, item.stageId ?? null)
  const swap = planMove(siblings, id, direction)
  if (!swap) return fail('nothing', 'It is already at the end of the list.')

  await prisma.$transaction(async (tx) => {
    for (const row of [swap.a, swap.b]) {
      if (kind === 'department') {
        await tx.department.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } })
      } else if (kind === 'ward') {
        await tx.ward.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } })
      } else if (kind === 'area') {
        await tx.edArea.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } })
      } else {
        await tx.reason.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } })
      }
    }
    await writeAudit(
      ctx,
      kind,
      id,
      { name: item.name, sortOrder: item.sortOrder },
      { name: item.name, sortOrder: swap.a.sortOrder, moved: direction },
      tx,
    )
  })

  return { ok: true, id }
}
