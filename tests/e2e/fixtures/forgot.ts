import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { generateResetToken, hashResetToken } from '../../../src/lib/auth/reset-token'
import { E2E_USERS } from './seed-users'

/**
 * The Phase 16 fixtures (docs/specs/phase16-forgot-password.md, section 8).
 *
 * Its own accounts, one per Playwright project, because this spec CHANGES the password of the
 * account it drives: sharing `e2e_navigator` with the suite running beside it would break
 * whichever test signed in next.
 *
 * The owner role, like `seed-users.ts`, because the clean-up deletes rows the app role may not:
 * the previous run's tokens (so the three-an-hour rule starts fresh) and its outbox rows (so
 * "the newest mail for this address" is unambiguous).
 *
 * Cost-4 hashes: the work factor is asserted in the unit suite; here it would only slow start-up.
 */
export const FORGOT_USERS = {
  mobile: {
    username: 'e2e_forgot_mobile',
    password: 'e2e-forgot-password-phone',
    displayName: 'Fara Forgot (phone)',
    email: 'e2e_forgot_mobile@example.invalid',
  },
  desktop: {
    username: 'e2e_forgot_desktop',
    password: 'e2e-forgot-password-laptop',
    displayName: 'Fara Forgot (laptop)',
    email: 'e2e_forgot_desktop@example.invalid',
  },
} as const

export type ForgotUser = (typeof FORGOT_USERS)[keyof typeof FORGOT_USERS]

/** The account this project drives, so the two projects never touch each other's password. */
export function forgotUserFor(project: string): ForgotUser {
  return project === 'mobile' ? FORGOT_USERS.mobile : FORGOT_USERS.desktop
}

/** Two hours ago: outside `RESET_REQUEST_WINDOW_MS`, so a fixture costs nobody their quota. */
const OUTSIDE_THE_WINDOW = (): Date => new Date(Date.now() - 2 * 60 * 60_000)

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export async function seedForgotUsers(): Promise<void> {
  const prisma = ownerClient()
  try {
    for (const user of Object.values(FORGOT_USERS)) {
      const passwordHash = await bcrypt.hash(user.password, 4)
      const row = await prisma.user.upsert({
        where: { username: user.username },
        create: {
          username: user.username,
          passwordHash,
          displayName: user.displayName,
          role: 'NAVIGATOR',
          active: true,
          email: user.email,
        },
        update: {
          passwordHash,
          displayName: user.displayName,
          role: 'NAVIGATOR',
          active: true,
          email: user.email,
          failedLogins: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
        select: { id: true },
      })
      try {
        // Three links an hour per account is the rule; the previous run's tokens would spend it.
        await prisma.passwordResetToken.deleteMany({ where: { userId: row.id } })
        await prisma.outbox.deleteMany({ where: { to: user.email } })
      } catch (cause) {
        console.warn('[e2e] could not clear the previous run’s reset rows (owner role needed):', String(cause))
      }
    }
    // The screenshot spec writes a live token on `e2e_navigator`, which asks for no links and so
    // never invalidates one. Cleared here too, or every run leaves another row behind.
    try {
      const shots = await prisma.user.findUnique({
        where: { username: E2E_USERS.navigator.username },
        select: { id: true },
      })
      if (shots) await prisma.passwordResetToken.deleteMany({ where: { userId: shots.id } })
    } catch (cause) {
      console.warn('[e2e] could not clear the screenshot fixture’s reset tokens:', String(cause))
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The raw token out of the mail the app just wrote, which is exactly what a person reads. The
 * app writes the row inside the server action, so it is there by the time the page has answered;
 * the short retry is for the eventual case where it is not yet visible to this connection.
 */
export async function tokenFromOutbox(email: string): Promise<string> {
  const prisma = ownerClient()
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await prisma.outbox.findMany({ where: { to: email }, orderBy: { createdAt: 'desc' } })
      for (const row of rows) {
        const raw = /\/reset\?token=([A-Za-z0-9_%-]+)/.exec(row.text)?.[1]
        if (raw) return decodeURIComponent(raw)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`[e2e] no reset link in the outbox for ${email}`)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A link that died of old age, written straight to the database: the UI cannot make one without
 * waiting half an hour. Returns the raw token, which exists nowhere else.
 *
 * `createdAt` is backdated past the one-hour window on purpose, here and in `seedLiveToken`: the
 * three-links-an-hour rule counts token rows, and a fixture is not a request somebody made. Left
 * as `now` it would spend the quota the spec beside this one needs, including on a retry.
 */
export async function seedExpiredToken(username: string): Promise<string> {
  const prisma = ownerClient()
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } })
    const token = generateResetToken()
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        createdAt: OUTSIDE_THE_WINDOW(),
        expiresAt: new Date(Date.now() - 60_000),
        requestedIp: '203.0.113.99',
      },
    })
    return token
  } finally {
    await prisma.$disconnect()
  }
}

/** A live link for that account, without spending one of its three an hour on the form. */
export async function seedLiveToken(username: string): Promise<string> {
  const prisma = ownerClient()
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } })
    const token = generateResetToken()
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        createdAt: OUTSIDE_THE_WINDOW(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        requestedIp: '203.0.113.98',
      },
    })
    return token
  } finally {
    await prisma.$disconnect()
  }
}
