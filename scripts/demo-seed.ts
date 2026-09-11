/**
 * The hosted demo's contents (Phase 12 item 3, readiness audit D7 and D4).
 *
 * `prisma/seed.ts` is documented "Idempotent, never touches Case data", and the Phase 11 kit is a
 * Playwright script that needs a browser, ends with every case resolved and hands out random
 * passwords. A hosted demo needs a board and a dashboard worth looking at, seeded server-side, in
 * seconds, repeatably.
 *
 * SHIPPED LIKE THE WORKER. esbuild bundles this file to `dist/demo-seed.js` in the Docker build
 * stage and the runner image carries it beside `worker.js`; it runs with plain `node` inside the
 * demo app's container, which has no package manager, no TypeScript and no node_modules.
 * `docker exec` does not run the image's ENTRYPOINT, so the allowlist does not strip what is
 * passed on the exec line and none of these values has to live in the container's environment:
 *
 *   sudo docker exec -e DATABASE_URL="$OWNER_URL" -e INSTANCE_LABEL=DEMO \
 *     -e DEMO_USER_PASSWORD="$DEMO_PW" "$APPC" node demo-seed.js
 *
 * IT REFUSES, in this order, and each refusal is an exit code 1 and a message that names no MRN,
 * no username and no secret:
 *   1. INSTANCE_LABEL is not set — this is not a labelled demo instance;
 *   2. DEMO_USER_PASSWORD is missing or shorter than the app's own NEW_PASSWORD_MIN. Never a
 *      literal in this repository, never printed, never logged;
 *   3. DATABASE_URL is missing, or names a production host (src/lib/demo-guard.ts);
 *   4. the database already holds a Case opened by someone who is not a demo user;
 *   5. the database already holds a Case whose MRN is outside the demo prefix — belt and braces
 *      for the same question.
 * Refusals 4 and 5 are whole-table counts on purpose: that is the safety property, and scoping
 * them to "the demo's own rows" would answer a different question.
 *
 * MRNs. `MRN_RE` is `/^\d+$/` — digits only, no length bound — so the pattern is chosen, not
 * derived: six 9s and a two-digit ordinal, eight digits in all. Valid under the app's own rule,
 * not the 7-digit shape the hospital's sheets use, and it reads as invented at a glance on the
 * board and on paper.
 *
 * IDEMPOTENT. A second run adds nothing and exits 0: users are upserted by username and an
 * existing row's password is left exactly as it is (so a reset by hand survives), and each case is
 * created only when no Case with that MRN exists.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { hashPassword, NEW_PASSWORD_MIN } from '../src/lib/auth/password'
import { assertDemoTarget } from '../src/lib/demo-guard'
import { instanceLabel } from '../src/lib/instance'

/** Six 9s. No real record number begins with it, and it is still `/^\d+$/`. */
export const DEMO_MRN_PREFIX = '999999'

/** `demoMrn(1) === '99999901'`. Two digits, so 1..99. */
export function demoMrn(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error(`[demo-seed] ordinal out of range: ${n}`)
  return `${DEMO_MRN_PREFIX}${String(n).padStart(2, '0')}`
}

type DemoUserSeed = {
  username: string
  displayName: string
  role: 'NAVIGATOR' | 'SUPERVISOR' | 'VIEWER'
  email: string
}

/**
 * Four accounts, obviously invented. `.invalid` is reserved by RFC 2606, so Admin → Users has a
 * populated column, the worker's log line reads "would have emailed", and nothing can ever leave
 * the host. Every username satisfies USERNAME_RE (3–32, lower case, digits, dot, dash, underscore).
 */
const DEMO_USERS: ReadonlyArray<DemoUserSeed> = [
  { username: 'demo.nav.a', displayName: 'Demo Navigator A', role: 'NAVIGATOR', email: 'demo.nav.a@demo.invalid' },
  { username: 'demo.nav.b', displayName: 'Demo Navigator B', role: 'NAVIGATOR', email: 'demo.nav.b@demo.invalid' },
  { username: 'demo.charge', displayName: 'Demo Charge Nurse', role: 'SUPERVISOR', email: 'demo.charge@demo.invalid' },
  { username: 'demo.lead', displayName: 'Demo Leadership (read-only)', role: 'VIEWER', email: 'demo.lead@demo.invalid' },
]

/** Used by refusal 4, and by the database test that proves it. */
export const DEMO_USERNAMES: ReadonlyArray<string> = DEMO_USERS.map((u) => u.username)

const H = 3_600_000

type UpdateSeed = { hoursAgo: number; text: string; action?: 'LEADERSHIP_ESCALATION' | 'BED_MANAGEMENT' | 'FAX_RCC' }

type CaseSeed = {
  n: number
  by: string
  /** Hours before `now` that the LOS clock starts. */
  registeredHoursAgo: number
  shift: 'MORNING' | 'EVENING' | 'NIGHT'
  ctas: number
  areaCode: string
  payer: 'GOVERNMENT' | 'INSURED' | 'SELF_PAY'
  diagnosis: string
  /** Stage code -> reason name. The first entry is the primary reason. */
  reasons: ReadonlyArray<{ stage: string; reason: string; otherText?: string }>
  department?: string
  referralNo?: string
  updates?: ReadonlyArray<UpdateSeed>
  resolve?: {
    /** Hours after registration that the patient left; the LOS clock freezes there. */
    departedAfterHours: number
    disposition: 'ADMITTED' | 'DISCHARGED_HOME' | 'TRANSFERRED' | 'REFERRED_UCC'
    wardCode?: string
    note?: string
  }
}

/**
 * Six open cases across all five elapsed bands (`band()` is ok < 4 h, h4 4–6, h6 6–12, h12 12–24,
 * h24 >= 24) and four resolved across ten days, so the board shows every colour, the dashboard's
 * medians clear MIN_N = 3 over the 30-day range, and the printed report is not empty. No Alert
 * rows are seeded: the demo's own worker fires 4 h, 6 h, 12 h and 24 h on cases 3–6 within one
 * cycle, which is the alert story the presenter shows.
 */
const CASES: ReadonlyArray<CaseSeed> = [
  {
    n: 1,
    by: 'demo.nav.a',
    registeredHoursAgo: 1 + 20 / 60,
    shift: 'MORNING',
    ctas: 3,
    areaCode: 'RAZ',
    payer: 'GOVERNMENT',
    diagnosis: 'abdominal pain, for review',
    reasons: [{ stage: 'inv', reason: 'Lab: delay in sample collection' }],
  },
  {
    n: 2,
    by: 'demo.nav.b',
    registeredHoursAgo: 2 + 40 / 60,
    shift: 'MORNING',
    ctas: 4,
    areaCode: 'ACUTE',
    payer: 'INSURED',
    diagnosis: 'ankle injury, awaiting X-ray',
    reasons: [{ stage: 'inv', reason: 'Imaging: acquisition delay (X-ray/KUB)' }],
    updates: [{ hoursAgo: 1, text: 'Chased radiology; slot promised within the hour.' }],
  },
  {
    n: 3,
    by: 'demo.nav.a',
    registeredHoursAgo: 4 + 45 / 60,
    shift: 'MORNING',
    ctas: 2,
    areaCode: 'ACUTE',
    payer: 'GOVERNMENT',
    diagnosis: 'chest pain, cardiology asked to see',
    reasons: [{ stage: 'ref', reason: 'Awaiting consulted team response/callback' }],
    department: 'Internal Medicine',
    updates: [{ hoursAgo: 2, text: 'Consult call placed, no callback yet.' }],
  },
  {
    n: 4,
    by: 'demo.nav.b',
    registeredHoursAgo: 8 + 10 / 60,
    shift: 'NIGHT',
    ctas: 3,
    areaCode: 'POOL',
    payer: 'GOVERNMENT',
    diagnosis: 'pneumonia, for admission',
    reasons: [
      { stage: 'adm', reason: 'No bed available on accepting ward' },
      { stage: 'dispo', reason: 'Plan made, awaiting written admission order' },
    ],
    updates: [
      { hoursAgo: 5, text: 'Bed manager informed; nothing free on the medical ward.', action: 'BED_MANAGEMENT' },
      { hoursAgo: 2, text: 'Escalated to the on-call medical administrator.', action: 'LEADERSHIP_ESCALATION' },
    ],
  },
  {
    n: 5,
    by: 'demo.nav.a',
    registeredHoursAgo: 15.5,
    shift: 'NIGHT',
    ctas: 3,
    areaCode: 'ISO',
    payer: 'SELF_PAY',
    diagnosis: 'fever, isolation required',
    reasons: [
      { stage: 'exam', reason: 'Waiting for isolation/negative pressure room' },
      { stage: 'adm', reason: 'Other', otherText: 'Cleaning team short-staffed overnight; room not turned around.' },
    ],
    updates: [{ hoursAgo: 6, text: 'Housekeeping supervisor called.', action: 'FAX_RCC' }],
  },
  {
    n: 6,
    by: 'demo.nav.b',
    registeredHoursAgo: 28,
    shift: 'EVENING',
    ctas: 2,
    areaCode: 'ACUTE',
    payer: 'INSURED',
    diagnosis: 'sepsis, ICU bed requested',
    reasons: [
      { stage: 'adm', reason: 'No bed available on accepting ward' },
      { stage: 'ref', reason: 'Disagreement between teams on ownership' },
    ],
    department: 'ICU',
    updates: [
      { hoursAgo: 20, text: 'ICU asked to accept; awaiting bed.', action: 'BED_MANAGEMENT' },
      { hoursAgo: 10, text: 'Second escalation to the medical administrator on call.', action: 'LEADERSHIP_ESCALATION' },
      { hoursAgo: 3, text: 'Still in the department; family updated.' },
    ],
  },
  {
    n: 7,
    by: 'demo.nav.a',
    registeredHoursAgo: 2 * 24,
    shift: 'MORNING',
    ctas: 3,
    areaCode: 'ACUTE',
    payer: 'GOVERNMENT',
    diagnosis: 'cellulitis, admitted',
    reasons: [{ stage: 'adm', reason: 'Bed available, awaiting transport/porter' }],
    updates: [{ hoursAgo: 2 * 24 - 4, text: 'Porter booked.' }],
    resolve: { departedAfterHours: 7, disposition: 'ADMITTED', wardCode: 'MMW', note: 'Handed over to the ward.' },
  },
  {
    n: 8,
    by: 'demo.nav.b',
    registeredHoursAgo: 4 * 24,
    shift: 'EVENING',
    ctas: 4,
    areaCode: 'RAZ',
    payer: 'INSURED',
    diagnosis: 'migraine, treated and discharged',
    reasons: [{ stage: 'inv', reason: 'Lab: delay in processing' }],
    resolve: { departedAfterHours: 5, disposition: 'DISCHARGED_HOME', note: 'Discharged with instructions.' },
  },
  {
    n: 9,
    by: 'demo.nav.a',
    registeredHoursAgo: 7 * 24,
    shift: 'NIGHT',
    ctas: 2,
    areaCode: 'RESUS',
    payer: 'GOVERNMENT',
    diagnosis: 'head injury, transferred out',
    reasons: [{ stage: 'adm', reason: 'Referred out: no bed in accepting department' }],
    referralNo: 'DEMO-REF-0091',
    updates: [{ hoursAgo: 7 * 24 - 6, text: 'Referral accepted by the receiving hospital.' }],
    resolve: { departedAfterHours: 13, disposition: 'TRANSFERRED', note: 'Transferred by ambulance.' },
  },
  {
    n: 10,
    by: 'demo.nav.b',
    registeredHoursAgo: 10 * 24,
    shift: 'MORNING',
    ctas: 5,
    areaCode: 'POOL',
    payer: 'SELF_PAY',
    diagnosis: 'minor complaint, sent to urgent care',
    reasons: [{ stage: 'reg', reason: 'Registration desk/system delay' }],
    resolve: { departedAfterHours: 3, disposition: 'REFERRED_UCC', note: 'Redirected to the urgent care centre.' },
  },
]

export type DemoSeedDeps = {
  env?: NodeJS.ProcessEnv
  /** Injected by the database test, which owns a Postgres schema of its own. */
  prisma?: PrismaClient
  now?: Date
}

export type DemoSeedSummary = {
  users: number
  usersCreated: number
  cases: number
  casesCreated: number
}

export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoSeedError'
  }
}

function refuse(message: string): never {
  throw new DemoSeedError(`[demo-seed] refusing: ${message}`)
}

export async function runDemoSeed(deps: DemoSeedDeps = {}): Promise<DemoSeedSummary> {
  const env = deps.env ?? process.env
  const now = deps.now ?? new Date()

  // 1 — this must be a labelled instance.
  if (instanceLabel(env) === null) refuse('INSTANCE_LABEL is not set')

  // 2 — one shared password, supplied on the exec line, never a literal here.
  const password = env.DEMO_USER_PASSWORD ?? ''
  if (password.length < NEW_PASSWORD_MIN) {
    refuse(`DEMO_USER_PASSWORD is missing or shorter than ${NEW_PASSWORD_MIN} characters`)
  }

  // 3 — a target, and not production's.
  const url = env.DATABASE_URL ?? ''
  if (!url) refuse('DATABASE_URL is not set')
  assertDemoTarget(url, env)

  // The test injects its own client, on a Postgres schema of its own; the process path builds one
  // here — after the refusals, so a bad environment never opens a connection — and closes it below.
  const ownClient = deps.prisma ? null : defaultClient(url)
  const prisma = deps.prisma ?? ownClient!
  try {
    return await seed(prisma, password, now)
  } finally {
    if (ownClient) await ownClient.$disconnect().catch(() => undefined)
  }
}

async function seed(prisma: PrismaClient, password: string, now: Date): Promise<DemoSeedSummary> {
  const summary: DemoSeedSummary = { users: DEMO_USERS.length, usersCreated: 0, cases: CASES.length, casesCreated: 0 }

  // 4 and 5 — whole-table counts, so a database with anyone else's work in it is left alone.
  const foreignByAuthor = await prisma.case.count({
    where: { openedBy: { username: { notIn: [...DEMO_USERNAMES] } } },
  })
  if (foreignByAuthor > 0) {
    refuse(`the database holds ${foreignByAuthor} cases opened by someone who is not a demo user`)
  }
  const foreignByMrn = await prisma.case.count({ where: { NOT: { mrn: { startsWith: DEMO_MRN_PREFIX } } } })
  if (foreignByMrn > 0) {
    refuse(`the database holds ${foreignByMrn} cases whose MRN is not a demo MRN`)
  }

  const passwordHash = await hashPassword(password)
  const userIds = new Map<string, string>()
  for (const seed of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { username: seed.username }, select: { id: true } })
    if (existing) {
      userIds.set(seed.username, existing.id)
      continue
    }
    const row = await prisma.user.create({
      data: {
        username: seed.username,
        displayName: seed.displayName,
        role: seed.role,
        email: seed.email,
        passwordHash,
        active: true,
        // Explicitly off (Phase 12 item 5): fifteen people at a demo must not each be sent to
        // /account on their first tap.
        mustChangePassword: false,
      },
      select: { id: true },
    })
    userIds.set(seed.username, row.id)
    summary.usersCreated += 1
  }

  const reference = await loadReference(prisma)

  for (const seed of CASES) {
    const mrn = demoMrn(seed.n)
    if (await prisma.case.findFirst({ where: { mrn }, select: { id: true } })) continue
    await createDemoCase(prisma, seed, mrn, userIds, reference, now)
    summary.casesCreated += 1
  }

  return summary
}

type Reference = {
  reasonIds: Map<string, string>
  stageIds: Map<string, string>
  areaIds: Map<string, string>
  departmentIds: Map<string, string>
  wardIds: Map<string, string>
}

async function loadReference(prisma: PrismaClient): Promise<Reference> {
  const [stages, areas, departments, wards] = await Promise.all([
    prisma.stage.findMany({ select: { id: true, code: true, reasons: { select: { id: true, name: true } } } }),
    prisma.edArea.findMany({ select: { id: true, code: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.ward.findMany({ select: { id: true, code: true } }),
  ])
  if (stages.length === 0) {
    refuse('the reference lists are empty — run prisma/seed.ts before this script')
  }
  const reasonIds = new Map<string, string>()
  const stageIds = new Map<string, string>()
  for (const stage of stages) {
    stageIds.set(stage.code, stage.id)
    for (const reason of stage.reasons) reasonIds.set(`${stage.code}/${reason.name}`, reason.id)
  }
  return {
    reasonIds,
    stageIds,
    areaIds: new Map(areas.map((a) => [a.code, a.id])),
    departmentIds: new Map(departments.map((d) => [d.name, d.id])),
    wardIds: new Map(wards.map((w) => [w.code, w.id])),
  }
}

function need<T>(map: Map<string, T>, key: string, what: string): T {
  const value = map.get(key)
  if (value === undefined) refuse(`the reference lists have no ${what} "${key}"`)
  return value
}

async function createDemoCase(
  prisma: PrismaClient,
  seed: CaseSeed,
  mrn: string,
  userIds: Map<string, string>,
  reference: Reference,
  now: Date,
): Promise<void> {
  const openedById = need(userIds, seed.by, 'demo user')
  const registrationAt = new Date(now.getTime() - seed.registeredHoursAgo * H)
  const departedAt = seed.resolve ? new Date(registrationAt.getTime() + seed.resolve.departedAfterHours * H) : null
  const primary = seed.reasons[0]!
  const primaryReasonId = need(reference.reasonIds, `${primary.stage}/${primary.reason}`, 'reason')

  const created = await prisma.case.create({
    data: {
      mrn,
      registrationAt,
      // Backdated too: a case the board says arrived two days ago was not opened a second ago.
      openedAt: new Date(registrationAt.getTime() + 12 * 60_000),
      openedById,
      shift: seed.shift,
      ctas: seed.ctas,
      areaId: need(reference.areaIds, seed.areaCode, 'ED area'),
      payer: seed.payer,
      diagnosis: seed.diagnosis,
      primaryReasonId,
      triageAt: new Date(registrationAt.getTime() + 15 * 60_000),
      physicianAt: new Date(registrationAt.getTime() + 55 * 60_000),
      referralTrackingNo: seed.referralNo ?? null,
      ...(seed.resolve
        ? {
            status: 'RESOLVED' as const,
            decisionAt: new Date(registrationAt.getTime() + (seed.resolve.departedAfterHours - 1) * H),
            departedAt,
            resolvedAt: departedAt,
            disposition: seed.resolve.disposition,
            wardId: seed.resolve.wardCode
              ? need(reference.wardIds, seed.resolve.wardCode, 'ward')
              : null,
            resolutionNote: seed.resolve.note ?? null,
          }
        : {}),
    },
    select: { id: true },
  })

  for (const r of seed.reasons) {
    await prisma.caseReason.create({
      data: {
        caseId: created.id,
        reasonId: need(reference.reasonIds, `${r.stage}/${r.reason}`, 'reason'),
        otherText: r.otherText ?? null,
      },
    })
    // The case service queues every "Other" description for Admin to promote or dismiss; the
    // demo's review queue should not be empty when the presenter opens it.
    if (r.otherText) {
      await prisma.otherReview.create({
        data: {
          caseId: created.id,
          stageId: need(reference.stageIds, r.stage, 'stage'),
          text: r.otherText,
          status: 'PENDING',
        },
      })
    }
  }

  if (seed.department) {
    await prisma.caseConsult.create({
      data: {
        caseId: created.id,
        departmentId: need(reference.departmentIds, seed.department, 'department'),
        consultedAt: new Date(registrationAt.getTime() + 70 * 60_000),
      },
    })
  }

  for (const u of seed.updates ?? []) {
    await prisma.caseUpdate.create({
      data: {
        caseId: created.id,
        authorId: openedById,
        createdAt: new Date(now.getTime() - u.hoursAgo * H),
        text: u.text,
        action: u.action ?? null,
      },
    })
  }

  if (seed.resolve && departedAt) {
    await prisma.caseUpdate.create({
      data: {
        caseId: created.id,
        authorId: openedById,
        createdAt: departedAt,
        text: `Resolved: ${seed.resolve.disposition}`,
        system: true,
      },
    })
  }
}

function defaultClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

/** The process wrapper. `runDemoSeed` takes every dependency, so the test never comes through here. */
async function main(): Promise<void> {
  const summary = await runDemoSeed()
  console.log(
    `[demo-seed] users ${summary.users} (${summary.usersCreated} created), cases ${summary.cases} (${summary.casesCreated} created)`,
  )
}

// `require.main === module` under the cjs bundle esbuild produces; never true when the database
// test imports this file through vitest.
if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
