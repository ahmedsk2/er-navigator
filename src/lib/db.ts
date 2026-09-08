import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * One PrismaClient per process, created lazily on first query. Import `prisma` everywhere;
 * never `new PrismaClient()` in feature code (plan §7: Prisma only, no raw SQL — the only
 * $queryRaw in the codebase is the readiness probe's SELECT 1).
 *
 * Uses the pg driver adapter (Prisma 7 has no native engine), which runs on the Windows-ARM64
 * dev box and the Linux-ARM64 prod host alike. Timeouts bound a hung query so one stuck
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
  if (globalForPrisma.prisma) return globalForPrisma.prisma
  const client = createClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
  return client
}

/** Lazy handle: importing this module never connects; the first query does. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
