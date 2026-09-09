import bcrypt from 'bcryptjs'
import { LOCKOUT_MS } from '../../src/lib/auth/lockout'
import { prisma } from '../../src/lib/db'
import { seedBoardCases } from './fixtures/board-cases'
import { seedDashboardCases } from './fixtures/dashboard-cases'
import { seedE2EUsers } from './fixtures/seed-users'

/**
 * One fixture the e2e suite cannot create through the UI: an account that is already locked.
 * Written straight to the database with the same role the app runs as (the app role may INSERT
 * and UPDATE User, only DELETE is revoked), so the fixture is upserted, never deleted.
 *
 * Cost 4: no test signs in as this user successfully, and a cost-12 hash would just slow the
 * suite's start-up.
 */
export const LOCKED_USERNAME = 'e2e_locked'
export const LOCKED_PASSWORD = 'e2e-locked-password'

export default async function globalSetup(): Promise<void> {
  const passwordHash = await bcrypt.hash(LOCKED_PASSWORD, 4)
  const lockedUntil = new Date(Date.now() + LOCKOUT_MS)
  await prisma.user.upsert({
    where: { username: LOCKED_USERNAME },
    create: {
      username: LOCKED_USERNAME,
      passwordHash,
      displayName: 'Locked Fixture',
      role: 'NAVIGATOR',
      active: true,
      failedLogins: 0,
      lockedUntil,
    },
    update: { passwordHash, active: true, failedLogins: 0, lockedUntil },
  })
  await prisma.$disconnect()

  // Phase 2: the navigator, supervisor and viewer accounts the case tests sign in as, seeded
  // through the owner role so the previous run's fixture cases can be cleared too.
  await seedE2EUsers()

  // Phase 3: a board worth looking at — eight cases across every band, plus a voided one that
  // must never appear. Strictly after seedE2EUsers(), which is what clears the last run's copies.
  await seedBoardCases()

  // Phase 4: twenty-nine days of cases so the dashboard's ranges, weekly chart, consult and
  // investigation medians and Other queue all have something real to show.
  await seedDashboardCases()
}
