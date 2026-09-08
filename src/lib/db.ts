import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * One PrismaClient per process, created lazily on first query and cached for the life of the
 * process in every environment. (Caching only outside production, the common Next.js snippet,
 * would create a fresh pg.Pool per query in production and exhaust Postgres connections.)
 *
 * Import `prisma` everywhere; never `new PrismaClient()` in feature code. The only raw SQL in
 * application code is the readiness probe's SELECT 1; prisma/sync-app-role.ts is an operator
 * script run by the migrate container as the owner role, not application code.
 *
 * Uses the pg driver adapter (Prisma 7 has no native engine), which runs on the Windows ARM64
 * dev box and the Linux ARM64 prod host alike. Timeouts bound a hung query so one stuck
 * connection cannot stall the board.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set — the database client cannot start.')
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
    max: 10,
    idleTimeoutMillis: 30_000,
  })
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] })
}

function getClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient()
  return globalForPrisma.prisma
}

/** Lazy handle: importing this module never connects; the first query does. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
