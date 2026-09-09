import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { E2E_USERS } from './seed-users'

/**
 * A dashboard worth reading: twelve cases spread over the last twenty-nine days, so the range
 * chips actually change the answer, the weekly chart has more than one week, and enough consults,
 * investigations and resolutions exist for a median to clear `MIN_N` instead of rendering "n<3".
 *
 * Written straight to the database (owner role) for the same reason the board fixture is: a case
 * that registered twenty-nine days ago and left the department twenty-six hours later is not
 * something a test should type into an editor.
 *
 * The MRNs are seven digits starting `32000`, which nothing else in the suite uses — the board
 * fixture is `310000`, the case flow generates six digits — so a dashboard assertion can name
 * exactly these rows even though the other spec files are opening their own cases against the
 * same database at the same time. Assertions match the list, never the prefix: `3200010` does not
 * start with `320000`, and a six-digit MRN elsewhere could contain `32000` by chance. They belong
 * to the e2e navigator, so `seedE2EUsers()` clears the previous run's copies before this seeds a
 * fresh set.
 */

const HOUR = 36e5

type Seed = {
  mrn: string
  /** Hours before "now" that the patient registered. */
  registeredHoursAgo: number
  /** Hours of total ED stay; present only on a resolved case. */
  losHours?: number
  shift: 'MORNING' | 'EVENING' | 'NIGHT'
  reason: { stage: string; name: string }
  /** Free text typed into the stage's "Other" box, which the Other review queue lists. */
  other?: { stage: string; text: string }
  /** Departments consulted, with hours after registration for consulted / seen / replied. */
  consults?: ReadonlyArray<{ name: string; consulted: number; seen?: number; replied?: number }>
  investigation?: { type: 'LAB' | 'CT' | 'US' | 'XR'; ordered: number; mid: number; done: number }
  /** Admission chain, in hours after registration. */
  admission?: { order: number; requested: number; assigned: number }
  disposition?: 'ADMITTED' | 'DISCHARGED_HOME' | 'DISCHARGED_DAMA' | 'LEFT_WITHOUT_BEING_SEEN'
  ward?: string
}

/** The Other text the queue must show. Distinctive enough that no other fixture can produce it. */
export const DASHBOARD_OTHER_TEXT = 'Family travelling from Dammam to collect the patient'

export const DASHBOARD_CASES: ReadonlyArray<Seed> = [
  {
    mrn: '3200001',
    registeredHoursAgo: 700,
    losHours: 26,
    shift: 'MORNING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [{ name: 'MROD', consulted: 2, seen: 4, replied: 5 }],
    admission: { order: 3, requested: 4, assigned: 20 },
    disposition: 'ADMITTED',
    ward: 'ICU',
  },
  {
    mrn: '3200002',
    registeredHoursAgo: 600,
    losHours: 14,
    shift: 'EVENING',
    reason: { stage: 'inv', name: 'Imaging: report delay' },
    investigation: { type: 'CT', ordered: 2, mid: 5, done: 9 },
    disposition: 'DISCHARGED_HOME',
  },
  {
    mrn: '3200003',
    registeredHoursAgo: 500,
    losHours: 9,
    shift: 'NIGHT',
    reason: { stage: 'ref', name: 'Awaiting consulted team response/callback' },
    consults: [
      { name: 'MROD', consulted: 1, seen: 3, replied: 4 },
      { name: 'Internal Medicine', consulted: 2, seen: 6 },
    ],
    disposition: 'ADMITTED',
    ward: 'FMW',
  },
  {
    mrn: '3200004',
    registeredHoursAgo: 400,
    losHours: 7,
    shift: 'MORNING',
    reason: { stage: 'dc', name: 'Awaiting pharmacy' },
    disposition: 'DISCHARGED_HOME',
  },
  {
    mrn: '3200005',
    registeredHoursAgo: 300,
    losHours: 5,
    shift: 'EVENING',
    reason: { stage: 'triage', name: 'Waiting for triage nurse availability' },
    disposition: 'DISCHARGED_DAMA',
  },
  {
    mrn: '3200006',
    registeredHoursAgo: 200,
    losHours: 3,
    shift: 'NIGHT',
    reason: { stage: 'reg', name: 'Registration desk/system delay' },
    disposition: 'LEFT_WITHOUT_BEING_SEEN',
  },
  {
    mrn: '3200007',
    registeredHoursAgo: 100,
    losHours: 30,
    shift: 'MORNING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [{ name: 'MROD', consulted: 2, seen: 5, replied: 7 }],
    admission: { order: 4, requested: 5, assigned: 25 },
    disposition: 'ADMITTED',
    ward: 'MMW',
  },
  // The open half of the board, one per band.
  {
    mrn: '3200008',
    registeredHoursAgo: 26,
    shift: 'EVENING',
    reason: { stage: 'adm', name: 'No bed available on accepting ward' },
    consults: [
      { name: 'MROD', consulted: 3, seen: 8 },
      { name: 'Internal Medicine', consulted: 4 },
    ],
  },
  {
    mrn: '3200009',
    registeredHoursAgo: 13,
    shift: 'NIGHT',
    reason: { stage: 'inv', name: 'Lab: delay in processing' },
    investigation: { type: 'LAB', ordered: 1, mid: 2, done: 6 },
  },
  {
    mrn: '3200010',
    registeredHoursAgo: 7,
    shift: 'MORNING',
    reason: { stage: 'ref', name: 'Referral sent, awaiting acceptance' },
    consults: [{ name: 'ICU', consulted: 2 }],
  },
  {
    mrn: '3200011',
    registeredHoursAgo: 5,
    shift: 'EVENING',
    reason: { stage: 'dispo', name: 'Awaiting senior/attending sign-off' },
  },
  {
    mrn: '3200012',
    registeredHoursAgo: 2,
    shift: 'NIGHT',
    reason: { stage: 'dc', name: 'Awaiting patient transport home' },
    other: { stage: 'dc', text: DASHBOARD_OTHER_TEXT },
  },
]

/** Every MRN this fixture writes. An assertion narrows to this list, never to a prefix. */
export const DASHBOARD_MRNS: ReadonlyArray<string> = DASHBOARD_CASES.map((c) => c.mrn)

/** Elapsed hours the dashboard will compute for each seeded case, for the drill-down assertions. */
export const elapsedOf = (seed: Seed): number => seed.losHours ?? seed.registeredHoursAgo

/** The fixture MRNs the "Over {t}h" drill-down must list, and by omission the ones it must not. */
export function fixtureMrnsOver(hours: number): string[] {
  return DASHBOARD_CASES.filter((c) => elapsedOf(c) >= hours)
    .map((c) => c.mrn)
    .sort()
}

/** Registered inside the last seven days: what the "7 days" chip must narrow the page down to. */
export const WITHIN_7_DAYS = DASHBOARD_CASES.filter((c) => c.registeredHoursAgo <= 7 * 24)

function ownerClient(): PrismaClient {
  const connectionString = process.env.E2E_OWNER_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('[e2e] E2E_OWNER_DATABASE_URL or DATABASE_URL must be set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export async function seedDashboardCases(): Promise<void> {
  const prisma = ownerClient()
  try {
    const navigator = await prisma.user.findUnique({
      where: { username: E2E_USERS.navigator.username },
      select: { id: true },
    })
    if (!navigator) throw new Error('[e2e] seedE2EUsers() must run before seedDashboardCases()')

    const [stages, departments, wards] = await Promise.all([
      prisma.stage.findMany({
        select: { code: true, reasons: { select: { id: true, name: true, isOther: true } } },
      }),
      prisma.department.findMany({ select: { id: true, name: true } }),
      prisma.ward.findMany({ select: { id: true, code: true } }),
    ])
    const reasonId = (stageCode: string, name: string): string => {
      const stage = stages.find((s) => s.code === stageCode)
      const reason = stage?.reasons.find((r) => r.name === name)
      if (!reason) throw new Error(`[e2e] the seed has no "${name}" reason under "${stageCode}"`)
      return reason.id
    }
    const otherReasonId = (stageCode: string): string => {
      const stage = stages.find((s) => s.code === stageCode)
      const reason = stage?.reasons.find((r) => r.isOther)
      if (!reason) throw new Error(`[e2e] the seed has no Other reason under "${stageCode}"`)
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

    for (const seed of DASHBOARD_CASES) {
      const registeredAt = ago(seed.registeredHoursAgo)
      /** A time `hours` after this patient registered. */
      const after = (hours: number): Date => ago(seed.registeredHoursAgo - hours)
      const left = seed.losHours == null ? null : after(seed.losHours)
      const primary = reasonId(seed.reason.stage, seed.reason.name)

      await prisma.case.create({
        data: {
          mrn: seed.mrn,
          registrationAt: registeredAt,
          openedAt: registeredAt,
          createdAt: registeredAt,
          openedById: navigator.id,
          shift: seed.shift,
          status: left ? 'RESOLVED' : 'OPEN',
          primaryReasonId: primary,
          departedAt: left,
          resolvedAt: left,
          disposition: seed.disposition ?? null,
          wardId: seed.ward ? wardId(seed.ward) : null,
          admOrderAt: seed.admission ? after(seed.admission.order) : null,
          bedRequestedAt: seed.admission ? after(seed.admission.requested) : null,
          bedAssignedAt: seed.admission ? after(seed.admission.assigned) : null,
          reasons: {
            create: [
              { reasonId: primary },
              ...(seed.other
                ? [{ reasonId: otherReasonId(seed.other.stage), otherText: seed.other.text }]
                : []),
            ],
          },
          consults: {
            create: (seed.consults ?? []).map((c) => ({
              departmentId: departmentId(c.name),
              consultedAt: after(c.consulted),
              seenAt: c.seen == null ? null : after(c.seen),
              repliedAt: c.replied == null ? null : after(c.replied),
            })),
          },
          investigations: {
            create: seed.investigation
              ? [
                  {
                    type: seed.investigation.type,
                    orderedAt: after(seed.investigation.ordered),
                    collectedAt:
                      seed.investigation.type === 'LAB' ? after(seed.investigation.mid) : null,
                    receivedAt:
                      seed.investigation.type === 'LAB' ? after(seed.investigation.mid + 0.5) : null,
                    doneAt: seed.investigation.type === 'LAB' ? null : after(seed.investigation.mid),
                    resultedAt: after(seed.investigation.done),
                  },
                ]
              : [],
          },
        },
        select: { id: true },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}
