/**
 * The database half of the alerts worker: the one implementation of `AlertStore`.
 *
 * Firing is one transaction — the Alert row, the system user's CaseUpdate and the `alert.fire`
 * audit row land together or not at all — and the unique index on `(caseId, thresholdHours)` is
 * what makes it idempotent: two workers, or one worker restarted mid-cycle, race into the same
 * INSERT and the loser gets P2002 and skips. Nothing here ever writes `medAdminInformedAt`.
 *
 * The worker connects as the limited app role, which may INSERT into Alert, CaseUpdate and
 * AuditLog and UPDATE Alert, and may delete none of them.
 */
import { audit, type AuditContext } from '@/src/lib/audit'
import { prisma } from '@/src/lib/db'
import type { AlertStore, FireOutcome, Recipient } from './cycle'
import type { AlertCase } from './rules'
import { thresholdUpdateText } from './rules'

/** Prisma's unique-constraint failure, without importing the error class into the bundle. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

export type PrismaLike = typeof prisma

/** The `system` user id, resolved once at start-up: the worker refuses to run without it. */
export async function requireSystemUserId(username: string, client: PrismaLike = prisma): Promise<string> {
  const row = await client.user.findUnique({ where: { username }, select: { id: true } })
  if (!row) {
    throw new Error(
      `[alerts] the "${username}" user is missing. Run the seed (prisma/seed.ts) before the worker.`,
    )
  }
  return row.id
}

export function prismaAlertStore(systemUserId: string, client: PrismaLike = prisma): AlertStore {
  const ctx: AuditContext = { actorId: systemUserId, ip: null, userAgent: 'alerts-worker' }

  return {
    async openCases(): Promise<AlertCase[]> {
      const rows = await client.case.findMany({
        where: { status: 'OPEN' },
        select: {
          id: true,
          mrn: true,
          status: true,
          registrationAt: true,
          departedAt: true,
          resolvedAt: true,
          primaryReason: { select: { name: true } },
          consults: { select: { department: { select: { name: true } } } },
        },
        orderBy: { registrationAt: 'asc' },
      })
      return rows.map((row) => ({
        id: row.id,
        mrn: row.mrn,
        status: row.status,
        registrationAt: row.registrationAt,
        departedAt: row.departedAt,
        resolvedAt: row.resolvedAt,
        primaryReason: row.primaryReason?.name ?? null,
        departments: row.consults.map((c) => c.department.name),
      }))
    },

    async firedThresholds(caseIds: string[]): Promise<Map<string, number[]>> {
      if (caseIds.length === 0) return new Map()
      const rows = await client.alert.findMany({
        where: { caseId: { in: caseIds } },
        select: { caseId: true, thresholdHours: true },
      })
      const map = new Map<string, number[]>()
      for (const row of rows) {
        const list = map.get(row.caseId)
        if (list) list.push(row.thresholdHours)
        else map.set(row.caseId, [row.thresholdHours])
      }
      return map
    },

    async fire(input): Promise<FireOutcome> {
      try {
        return await client.$transaction(async (tx) => {
          const alert = await tx.alert.create({
            data: { caseId: input.caseId, thresholdHours: input.thresholdHours, firedAt: input.now },
            select: { id: true },
          })
          await tx.caseUpdate.create({
            data: {
              caseId: input.caseId,
              authorId: systemUserId,
              createdAt: input.now,
              text: thresholdUpdateText(input.thresholdHours),
            },
          })
          await audit(
            {
              action: 'alert.fire',
              entity: 'Alert',
              entityId: alert.id,
              after: {
                caseId: input.caseId,
                thresholdHours: input.thresholdHours,
                firedAt: input.now.toISOString(),
              },
            },
            ctx,
            tx,
          )
          return { fired: true as const, alertId: alert.id }
        })
      } catch (error) {
        if (isUniqueViolation(error)) return { fired: false, reason: 'duplicate' }
        throw error
      }
    },

    async markEmailSent(alertId: string, at: Date): Promise<void> {
      await client.alert.update({ where: { id: alertId }, data: { emailSentAt: at } })
    },

    async recipients(): Promise<Recipient[]> {
      return client.user.findMany({
        where: { active: true, role: { in: ['SUPERVISOR', 'ADMIN'] } },
        select: { username: true, displayName: true },
        orderBy: { username: 'asc' },
      })
    },
  }
}
