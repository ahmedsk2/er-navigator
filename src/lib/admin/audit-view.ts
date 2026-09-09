/**
 * Admin → Audit log: the filtered, paginated read of the append-only `AuditLog`, and the
 * before/after diff the screen renders.
 *
 * The diff is deliberately a list of the keys that changed, not a JSON dump: an admin looking at
 * "who changed this case at 03:10" wants "status: OPEN → RESOLVED", not four hundred lines. Keys
 * that are equal on both sides are dropped; a create shows only `after`, a delete-shaped row only
 * `before`. Values are rendered compactly and truncated, because a snapshot can hold an array.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/db'

export const AUDIT_PAGE_SIZE = 50

export type AuditDiffRow = { key: string; before: string | null; after: string | null }

export type AuditRowView = {
  id: string
  at: string
  action: string
  entity: string
  entityId: string | null
  actor: string | null
  ip: string | null
  diff: AuditDiffRow[]
}

export type AuditFilters = {
  action: string | null
  entity: string | null
  actorId: string | null
  from: string | null
  to: string | null
  page: number
}

export type AuditPage = {
  rows: AuditRowView[]
  total: number
  page: number
  pageCount: number
  actions: string[]
  entities: string[]
  actors: Array<{ id: string; displayName: string }>
}

const MAX_VALUE_CHARS = 120

/** A JSON value as one short line. `null` and `undefined` both render as "—" upstream. */
export function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return json.length > MAX_VALUE_CHARS ? `${json.slice(0, MAX_VALUE_CHARS)}…` : json
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** The keys whose value differs, in the order before-then-after first mentions them. */
export function changedKeys(before: unknown, after: unknown): AuditDiffRow[] {
  const b = asRecord(before)
  const a = asRecord(after)
  if (!b && !a) {
    const only = renderValue(after ?? before)
    return only === null ? [] : [{ key: '', before: renderValue(before), after: renderValue(after) }]
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])]
  const rows: AuditDiffRow[] = []
  for (const key of keys) {
    const beforeValue = b ? b[key] : undefined
    const afterValue = a ? a[key] : undefined
    if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) continue
    rows.push({ key, before: renderValue(beforeValue), after: renderValue(afterValue) })
  }
  return rows
}

export function parseFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (v: string | string[] | undefined): string | null => {
    const value = Array.isArray(v) ? v[0] : v
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
  }
  const page = Number(one(params.page) ?? '1')
  return {
    action: one(params.action),
    entity: one(params.entity),
    actorId: one(params.actor),
    from: one(params.from),
    to: one(params.to),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  }
}

/** A calendar day in the filter box is the whole day, in the server's zone (UTC in production). */
export function dateRangeWhere(from: string | null, to: string | null): { gte?: Date; lte?: Date } | undefined {
  const gte = from ? new Date(`${from}T00:00:00.000Z`) : undefined
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined
  if (!gte && !lte) return undefined
  if (gte && Number.isNaN(gte.getTime())) return lte ? { lte } : undefined
  if (lte && Number.isNaN(lte.getTime())) return gte ? { gte } : undefined
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
}

export async function loadAuditPage(filters: AuditFilters): Promise<AuditPage> {
  const at = dateRangeWhere(filters.from, filters.to)
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(at ? { at } : {}),
  }

  const [total, rows, actionRows, entityRows, actors] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (filters.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        at: true,
        action: true,
        entity: true,
        entityId: true,
        before: true,
        after: true,
        ip: true,
        actor: { select: { displayName: true } },
      },
    }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.user.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
  ])

  return {
    rows: rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      actor: row.actor?.displayName ?? null,
      ip: row.ip,
      diff: changedKeys(row.before, row.after),
    })),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actions: actionRows.map((r) => r.action),
    entities: entityRows.map((r) => r.entity),
    actors,
  }
}
