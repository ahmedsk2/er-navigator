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
import type { AlertStore, FireOutcome, PendingEmail, Recipient } from './cycle'
import type { AlertCase } from './rules'
import { EMAIL_MAX_ATTEMPTS, EMAIL_THRESHOLD_H, thresholdUpdateText } from './rules'

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
              system: true,
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

    /**
     * The retry queue (Phase 12 item 6, readiness audit C1). Four conditions, and the third is
     * the one that keeps this honest: a patient who has left is not escalated, which is the same
     * rule `thresholdsDue()` states for firing. Oldest first, so a backlog drains in the order it
     * built up, and capped so one cycle cannot try to carry an unbounded queue.
     *
     * `now` is not part of the query — an alert that is due is due — but it is on the port so a
     * future rule ("nothing older than a day") has somewhere to go without changing every caller.
     */
    async pendingEmails(): Promise<PendingEmail[]> {
      const rows = await client.alert.findMany({
        where: {
          emailSentAt: null,
          thresholdHours: { gte: EMAIL_THRESHOLD_H },
          emailAttempts: { lt: EMAIL_MAX_ATTEMPTS },
          case: { status: 'OPEN' },
        },
        orderBy: { firedAt: 'asc' },
        take: 50,
        select: {
          id: true,
          caseId: true,
          thresholdHours: true,
          emailAttempts: true,
          case: {
            select: {
              mrn: true,
              status: true,
              registrationAt: true,
              departedAt: true,
              resolvedAt: true,
              primaryReason: { select: { name: true } },
              consults: { select: { department: { select: { name: true } } } },
            },
          },
        },
      })
      return rows.map((row) => ({
        alertId: row.id,
        caseId: row.caseId,
        thresholdHours: row.thresholdHours,
        attempts: row.emailAttempts,
        mrn: row.case.mrn,
        status: row.case.status,
        registrationAt: row.case.registrationAt,
        departedAt: row.case.departedAt,
        resolvedAt: row.case.resolvedAt,
        primaryReason: row.case.primaryReason?.name ?? null,
        departments: row.case.consults.map((c) => c.department.name),
      }))
    },

    /**
     * The durable trace C1 asked for: the counter, the stamp and one audit row, together or not
     * at all. No Alert row is ever inserted by this — the unique index on
     * (caseId, thresholdHours) is untouched, and the app role holds UPDATE on Alert already.
     */
    async markEmailFailed(alertId: string, at: Date): Promise<void> {
      await client.$transaction(async (tx) => {
        const row = await tx.alert.update({
          where: { id: alertId },
          data: { emailAttempts: { increment: 1 }, emailFailedAt: at },
          select: { id: true, caseId: true, thresholdHours: true, emailAttempts: true },
        })
        await audit(
          {
            action: 'alert.email.failed',
            entity: 'Alert',
            entityId: row.id,
            after: {
              caseId: row.caseId,
              thresholdHours: row.thresholdHours,
              attempts: row.emailAttempts,
            },
          },
          ctx,
          tx,
        )
      })
    },

    /**
     * Every active SUPERVISOR and ADMIN, with the work address an Admin typed on Admin → Users.
     * The rows without one are returned too, so the cycle can log by name who is on the list but
     * unreachable; only the ones with an address are actually emailed.
     */
    async recipients(): Promise<Recipient[]> {
      return client.user.findMany({
        where: { active: true, role: { in: ['SUPERVISOR', 'ADMIN'] } },
        select: { username: true, displayName: true, email: true },
        orderBy: { username: 'asc' },
      })
    },
  }
}
