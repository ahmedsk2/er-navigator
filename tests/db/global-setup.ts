import { prisma } from '../../src/lib/db'

/**
 * Guard for the database-backed suite. With no DATABASE_URL the suite is not included at all
 * (see vitest.config.ts) and this says so once. With a DATABASE_URL it proves the schema is
 * migrated, so "0 database tests ran" can never be mistaken for "the database tests passed".
 */
export async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('[tests/db] DATABASE_URL is not set — the database-backed suite is skipped.')
    return
  }
  try {
    await prisma.session.findFirst({ select: { id: true } })
  } catch (cause) {
    throw new Error(
      '[tests/db] DATABASE_URL is set but the schema is not usable. Run `prisma migrate deploy` ' +
        'against it first (the owner role).\n' +
        String(cause),
    )
  }
}

export async function teardown(): Promise<void> {
  if (process.env.DATABASE_URL) await prisma.$disconnect()
}
