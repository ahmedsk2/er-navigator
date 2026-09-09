import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

/**
 * The accounts the Phase 2 browser tests need, written straight to the database because the app
 * has no user-creation screen until Phase 6. Test-only: nothing here is imported by app code.
 *
 * Runs as the OWNER role (`E2E_OWNER_DATABASE_URL`), which is also what lets it clear the cases
 * these accounts left behind on the previous run — the app role has DELETE revoked on Case,
 * CaseUpdate and AuditLog on purpose. With only `DATABASE_URL` set the accounts are still seeded
 * and the clean-up is skipped with a warning, so a laptop run is never blocked by it.
 *
 * Cost-4 hashes: the work factor is asserted in the unit suite; here it would only slow start-up.
 */
export const E2E_USERS = {
  navigator: { username: 'e2e_navigator', password: 'e2e-navigator-password', displayName: 'Nadia Navigator', role: 'NAVIGATOR' },
  supervisor: { username: 'e2e_supervisor', password: 'e2e-supervisor-password', displayName: 'Sami Supervisor', role: 'SUPERVISOR' },
  viewer: { username: 'e2e_viewer', password: 'e2e-viewer-password', displayName: 'Vera Viewer', role: 'VIEWER' },
  admin: { username: 'e2e_admin', password: 'e2e-admin-password', displayName: 'Amal Admin', role: 'ADMIN' },
} as const satisfies Record<string, { username: string; password: string; displayName: string; role: Role }>

/**
 * The Phase 6 admin spec creates accounts through the UI, and nothing in this app deletes a user.
 * Every account it makes carries this prefix so the owner role can clear the previous run's,
 * which is also what lets the spec assert on "the account I just made".
 */
export const E2E_TEMP_USER_PREFIX = 'e2e_tmp_'

export type E2EUser = (typeof E2E_USERS)[keyof typeof E2E_USERS]

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

/** Remove everything the previous run's fixtures opened, so MRN assertions stay unambiguous. */
async function clearCasesOf(prisma: PrismaClient, userIds: string[]): Promise<void> {
  const cases = await prisma.case.findMany({ where: { openedById: { in: userIds } }, select: { id: true } })
  const ids = cases.map((c) => c.id)
  if (ids.length === 0) return
  const updates = await prisma.caseUpdate.findMany({ where: { caseId: { in: ids } }, select: { id: true } })
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...updates.map((u) => u.id)] } } })
  await prisma.otherReview.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.caseUpdate.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.caseReason.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.caseConsult.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.caseInvestigation.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.alert.deleteMany({ where: { caseId: { in: ids } } })
  await prisma.case.deleteMany({ where: { id: { in: ids } } })
}

/** The accounts the previous run's admin spec created through the UI. Owner role only. */
async function clearTemporaryUsers(prisma: PrismaClient): Promise<void> {
  const temporary = await prisma.user.findMany({
    where: { username: { startsWith: E2E_TEMP_USER_PREFIX } },
    select: { id: true },
  })
  if (temporary.length === 0) return
  const ids = temporary.map((u) => u.id)
  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

export async function seedE2EUsers(): Promise<void> {
  const prisma = ownerClient()
  try {
    const ids: string[] = []
    for (const user of Object.values(E2E_USERS)) {
      const passwordHash = await bcrypt.hash(user.password, 4)
      const row = await prisma.user.upsert({
        where: { username: user.username },
        create: {
          username: user.username,
          passwordHash,
          displayName: user.displayName,
          role: user.role,
          active: true,
        },
        update: {
          passwordHash,
          displayName: user.displayName,
          role: user.role,
          active: true,
          failedLogins: 0,
          lockedUntil: null,
        },
        select: { id: true },
      })
      ids.push(row.id)
    }
    try {
      await clearCasesOf(prisma, ids)
      await clearTemporaryUsers(prisma)
    } catch (cause) {
      console.warn('[e2e] could not clear previous fixture cases (owner role needed):', String(cause))
    }
  } finally {
    await prisma.$disconnect()
  }
}
