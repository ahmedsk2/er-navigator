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
} as const satisfies Record<string, { username: string; password: string; displayName: string; role: Role }>

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
    } catch (cause) {
      console.warn('[e2e] could not clear previous fixture cases (owner role needed):', String(cause))
    }
  } finally {
    await prisma.$disconnect()
  }
}
