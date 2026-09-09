/**
 * Reading fired alerts and acknowledging one. Split from the request plumbing the same way the
 * case mutations are, so `tests/db` can drive it directly.
 *
 * Acknowledging is SUPERVISOR and ADMIN (`alert.acknowledge` in the permission matrix); it is
 * reached from `/admin/alerts` and from the case editor's header. Nothing is ever deleted: an
 * alert is acknowledged, and a second acknowledgement leaves the first one's name and time in
 * place rather than overwriting them.
 */
import { audit, type AuditContext } from '@/src/lib/audit'
import { assertCan, type AuthUser } from '@/src/lib/auth/session'
import { prisma } from '@/src/lib/db'

export type AlertRow = {
  id: string
  caseId: string
  mrn: string
  thresholdHours: number
  firedAt: string
  emailSentAt: string | null
  acknowledgedBy: string | null
  acknowledgedAt: string | null
}

export type AcknowledgeResult =
  | { ok: true; alreadyAcknowledged: boolean }
  | { ok: false; error: 'missing' | 'forbidden' }

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export async function loadAlerts(limit = 200): Promise<AlertRow[]> {
  const rows = await prisma.alert.findMany({
    orderBy: [{ firedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      caseId: true,
      thresholdHours: true,
      firedAt: true,
      emailSentAt: true,
      acknowledgedAt: true,
      acknowledgedBy: { select: { displayName: true } },
      case: { select: { mrn: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    mrn: row.case.mrn,
    thresholdHours: row.thresholdHours,
    firedAt: row.firedAt.toISOString(),
    emailSentAt: iso(row.emailSentAt),
    acknowledgedBy: row.acknowledgedBy?.displayName ?? null,
    acknowledgedAt: iso(row.acknowledgedAt),
  }))
}

/** The deepest unacknowledged alert on a case, for the editor's header. */
export async function loadUnacknowledgedAlert(
  caseId: string,
): Promise<{ id: string; thresholdHours: number; firedAt: string } | null> {
  const row = await prisma.alert.findFirst({
    where: { caseId, acknowledgedAt: null },
    orderBy: [{ thresholdHours: 'desc' }],
    select: { id: true, thresholdHours: true, firedAt: true },
  })
  return row ? { id: row.id, thresholdHours: row.thresholdHours, firedAt: row.firedAt.toISOString() } : null
}

export async function acknowledgeAlert(
  actor: AuthUser,
  alertId: string,
  ctx: AuditContext,
  now: Date = new Date(),
): Promise<AcknowledgeResult> {
  await assertCan(actor, 'alert.acknowledge', ctx)

  return prisma.$transaction(async (tx): Promise<AcknowledgeResult> => {
    const before = await tx.alert.findUnique({
      where: { id: alertId },
      select: { id: true, caseId: true, thresholdHours: true, acknowledgedAt: true, acknowledgedById: true },
    })
    if (!before) return { ok: false, error: 'missing' }
    if (before.acknowledgedAt) return { ok: true, alreadyAcknowledged: true }

    await tx.alert.update({
      where: { id: alertId },
      data: { acknowledgedById: actor.id, acknowledgedAt: now },
    })
    await audit(
      {
        action: 'alert.acknowledge',
        entity: 'Alert',
        entityId: alertId,
        before: { acknowledgedById: null, acknowledgedAt: null },
        after: {
          caseId: before.caseId,
          thresholdHours: before.thresholdHours,
          acknowledgedById: actor.id,
          acknowledgedAt: now.toISOString(),
        },
      },
      ctx,
      tx,
    )
    return { ok: true, alreadyAcknowledged: false }
  })
}
