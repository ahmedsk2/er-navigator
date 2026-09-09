import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { E2E_USERS } from './seed-users'

/**
 * A board with something on it: eight cases spread across every elapsed-time band, one of them
 * resolved to a ward, one resolved home, plus a voided case that must never appear.
 *
 * Written straight to the database (owner role) rather than through the UI, because the point is
 * a case that registered thirty hours ago and has not been updated for twelve — times the editor
 * would let you type but no test should spend eight taps entering. `createdAt` is set explicitly
 * on both the case and its updates: the staleness line reads the newest of the two, and a row
 * created "now" can never be stale.
 *
 * All of them belong to the e2e navigator, so `seedE2EUsers()` clears the previous run's copies
 * before this seeds a fresh set. They are seven digits starting `310000`, which no six-digit MRN
 * the other fixtures generate (700000–999999, and the phase 2 screenshots' 555001) can contain,
 * so a board assertion narrows to exactly these rows by typing the prefix into the search box.
 */
export const BOARD_MRN_PREFIX = '310000'

const HOUR = 36e5

type Seed = {
  mrn: string
  /** Hours before "now" that the patient registered. */
  registeredHoursAgo: number
  /** Hours before "now" of the newest update, or null for a case nobody has updated. */
  updatedHoursAgo: number | null
  reason: { stage: string; name: string }
  departments?: string[]
  resolution?: { departedHoursAgo: number; disposition: 'ADMITTED' | 'DISCHARGED_HOME'; ward?: string }
  voided?: string
}

/** Ordered by the clock they will show, longest first, so the file reads like the board. */
export const BOARD_CASES: ReadonlyArray<Seed> = [
  {
    mrn: '3100001',
    registeredHoursAgo: 30,
    updatedHoursAgo: 12,
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
  },
  {
    mrn: '3100002',
    registeredHoursAgo: 13,
    updatedHoursAgo: 6,
    reason: { stage: 'ref', name: 'Referral sent, awaiting acceptance' },
    departments: ['Internal Medicine', 'ICU'],
  },
  {
    mrn: '3100003',
    registeredHoursAgo: 7,
    updatedHoursAgo: null,
    reason: { stage: 'inv', name: 'Imaging: report delay' },
  },
  {
    mrn: '3100004',
    registeredHoursAgo: 5,
    updatedHoursAgo: 0.25,
    reason: { stage: 'dispo', name: 'Awaiting senior/attending sign-off' },
  },
  {
    mrn: '3100005',
    registeredHoursAgo: 4.5,
    updatedHoursAgo: 3,
    reason: { stage: 'adm', name: 'Bed available, awaiting transport/porter' },
    departments: ['General Surgery'],
  },
  {
    mrn: '3100006',
    registeredHoursAgo: 1.5,
    updatedHoursAgo: 0.2,
    reason: { stage: 'triage', name: 'Waiting for triage nurse availability' },
  },
  {
    mrn: '3100007',
    registeredHoursAgo: 9,
    updatedHoursAgo: 4,
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    resolution: { departedHoursAgo: 3, disposition: 'ADMITTED', ward: 'ICU' },
  },
  {
    mrn: '3100008',
    registeredHoursAgo: 5,
    updatedHoursAgo: 2,
    reason: { stage: 'dc', name: 'Awaiting pharmacy' },
    resolution: { departedHoursAgo: 1, disposition: 'DISCHARGED_HOME' },
  },
  {
    mrn: '3100009',
    registeredHoursAgo: 20,
    updatedHoursAgo: null,
    reason: { stage: 'reg', name: 'Registration desk/system delay' },
    voided: 'opened twice by mistake',
  },
]

/** The one the board tests point at: longest stay, deepest band, oldest update. */
export const LONGEST = BOARD_CASES[0]!
/** Resolved to a ward, so the Resolved filter has something with an outcome line. */
export const RESOLVED = BOARD_CASES[6]!
/** Voided: it must not be on the board under any filter. */
export const VOIDED = BOARD_CASES[8]!

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export async function seedBoardCases(): Promise<void> {
  const prisma = ownerClient()
  try {
    const navigator = await prisma.user.findUnique({
      where: { username: E2E_USERS.navigator.username },
      select: { id: true },
    })
    if (!navigator) throw new Error('[e2e] seedE2EUsers() must run before seedBoardCases()')

    const [stages, departments, wards] = await Promise.all([
      prisma.stage.findMany({ select: { code: true, reasons: { select: { id: true, name: true } } } }),
      prisma.department.findMany({ select: { id: true, name: true } }),
      prisma.ward.findMany({ select: { id: true, code: true } }),
    ])
    const reasonId = (stageCode: string, name: string): string => {
      const stage = stages.find((s) => s.code === stageCode)
      const reason = stage?.reasons.find((r) => r.name === name)
      if (!reason) throw new Error(`[e2e] the seed has no "${name}" reason under "${stageCode}"`)
      return reason.id
    }
    const departmentId = (name: string): string => {
      const found = departments.find((d) => d.name === name)
      if (!found) throw new Error(`[e2e] the seed has no "${name}" department`)
      return found.id
    }
    const wardId = (code: string): string => {
      const found = wards.find((w) => w.code === code)
      if (!found) throw new Error(`[e2e] the seed has no "${code}" ward`)
      return found.id
    }

    const now = Date.now()
    const ago = (hours: number): Date => new Date(now - hours * HOUR)

    for (const seed of BOARD_CASES) {
      const reason = reasonId(seed.reason.stage, seed.reason.name)
      const registrationAt = ago(seed.registeredHoursAgo)
      const created = await prisma.case.create({
        data: {
          mrn: seed.mrn,
          registrationAt,
          openedAt: registrationAt,
          createdAt: registrationAt,
          openedById: navigator.id,
          shift: 'MORNING',
          status: seed.voided ? 'VOIDED' : seed.resolution ? 'RESOLVED' : 'OPEN',
          voidReason: seed.voided ?? null,
          primaryReasonId: reason,
          departedAt: seed.resolution ? ago(seed.resolution.departedHoursAgo) : null,
          resolvedAt: seed.resolution ? ago(seed.resolution.departedHoursAgo) : null,
          disposition: seed.resolution?.disposition ?? null,
          wardId: seed.resolution?.ward ? wardId(seed.resolution.ward) : null,
          reasons: { create: [{ reasonId: reason }] },
          consults: {
            create: (seed.departments ?? []).map((name) => ({
              departmentId: departmentId(name),
              consultedAt: registrationAt,
            })),
          },
        },
        select: { id: true },
      })

      if (seed.updatedHoursAgo != null) {
        await prisma.caseUpdate.create({
          data: {
            caseId: created.id,
            authorId: navigator.id,
            createdAt: ago(seed.updatedHoursAgo),
            text: `Handover note for ${seed.mrn}`,
          },
        })
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}
