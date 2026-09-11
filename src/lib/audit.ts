/**
 * Audit wrapper — locked plan section 4: one AuditLog row with before/after JSON for every
 * create, update, resolve, reopen, void, user change, list change and auth event. Append-only:
 * the app database role has UPDATE and DELETE revoked on AuditLog, and no code path deletes.
 *
 * Usage: `await audit({ action: 'case.update', entity: 'Case', entityId, before, after }, ctx)`.
 * `ctx` carries the actor and request facts; `requestContext()` builds it from Next headers.
 * Writes never throw into the caller's flow for auth events (a failed audit row must not turn a
 * login into a 500), but they do throw for domain mutations, which run inside a transaction so
 * the mutation and its audit row land together or not at all.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/db'

export type AuditAction =
  | 'case.create'
  | 'case.update'
  | 'case.resolve'
  | 'case.reopen'
  | 'case.void'
  | 'case.update.add'
  /** Phase 8b, decision H: a supervisor marked the case reviewed (after: reviewedAt/reviewedById). */
  | 'case.review'
  | 'alert.acknowledge'
  | 'alert.fire'
  | 'user.create'
  | 'user.update'
  | 'user.password'
  | 'list.update'
  | 'other.promote'
  | 'other.dismiss'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.fail'
  | 'auth.locked'
  | 'auth.forbidden'
  /**
   * Phase 12 (C2): a workbook was downloaded, and the printable report was rendered. Reads, both
   * of them, and on the record because a page of MRNs leaving the building is the fact an
   * information-governance question asks about. Deliberately spelled like the two actions in the
   * permission matrix they record, so the audit log and the matrix use one vocabulary.
   * after: { format, from, to, status, filter, filterDescription, cases } / the same without the
   * format and the count.
   */
  | 'export.xlsx'
  | 'report.print'
  | 'phi.scrub'

export type AuditContext = {
  actorId: string | null
  ip: string | null
  userAgent: string | null
}

export type AuditEntry = {
  action: AuditAction
  entity: string
  entityId?: string | null
  before?: unknown
  after?: unknown
}

/** A Prisma client or transaction client; the caller picks which. */
export type AuditClient = Pick<typeof prisma, 'auditLog'> | Prisma.TransactionClient

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
}

/** Write one audit row. Throws on failure (use inside the same transaction as the mutation). */
export async function audit(entry: AuditEntry, ctx: AuditContext, client: AuditClient = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      actorId: ctx.actorId,
      ip: ctx.ip,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 512) : null,
    },
  })
}

/** Same, but never throws: for auth events, where a logging failure must not become a 500. */
export async function auditQuietly(entry: AuditEntry, ctx: AuditContext): Promise<void> {
  try {
    await audit(entry, ctx)
  } catch (e) {
    console.error('[audit] failed to write', entry.action, e)
  }
}

/**
 * Client IP for rate limiting and audit. The origin is reachable only through Cloudflare (OCI
 * security list), so CF-Connecting-IP is trustworthy here; x-forwarded-for's first hop is the
 * fallback for local runs. If the origin is ever opened to the world, this must change.
 */
export function clientIpFrom(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return xff || null
}

export function contextFrom(headers: Headers, actorId: string | null): AuditContext {
  return { actorId, ip: clientIpFrom(headers), userAgent: headers.get('user-agent') }
}
