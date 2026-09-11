import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_MRN_PREFIX, DEMO_USERNAMES, demoMrn, runDemoSeed } from '@/scripts/demo-seed'
import { band, elapsedHours } from '@/src/lib/domain/time'

/**
 * Phase 12 item 3, against a real Postgres.
 *
 * IT OWNS A SCHEMA, and that is not a detail. Refusals 5 and 6 are whole-table counts — any Case
 * opened by a non-demo user, any MRN outside the demo prefix — which is the safety property and
 * must not be scoped away. The lead's local database permanently holds the Playwright fixture
 * cases and the sibling `tests/db` files create more in parallel, so refusal 5 would fire before
 * anything was created and every happy-path assertion here would throw instead of seeding.
 *
 * So the file migrates and seeds a schema of its own, hands `runDemoSeed` a client pointed at it,
 * and drops it again. The whole-table counts are then true counts over a schema nothing else
 * writes to, and this file can neither disturb nor be disturbed by its parallel siblings.
 */
const ROOT = path.resolve(__dirname, '../..')
const SCHEMA = 'demo_seed_test'
const PASSWORD = 'a-demo-only-password'
const ENV = { NODE_ENV: 'test' } as const

const parentUrl = process.env.DATABASE_URL
const describeDb = parentUrl ? describe : describe.skip

/**
 * Node refuses to spawn a `.cmd` directly since 20.x, and `shell: true` with an argument array is
 * deprecated (DEP0190). So Windows goes through `cmd.exe /c` explicitly and everything else calls
 * the binary; no argument here contains a space either way.
 */
const [CMD, PREFIX] =
  process.platform === 'win32' ? (['cmd.exe', ['/c', 'pnpm.cmd']] as const) : (['pnpm', []] as const)

/**
 * `?schema=` is read by the Prisma CLI for `migrate deploy`, and — since Phase 12 item 3 —
 * by `src/lib/db.ts`, which is how `prisma/seed.ts` lands its reference lists here rather than in
 * `public`. The driver adapter itself ignores the connection string's copy, so the test's own
 * client below passes the option explicitly as well.
 */
function testUrl(from: string): string {
  const url = new URL(from)
  url.searchParams.set('schema', SCHEMA)
  return url.toString()
}

/**
 * The append-only rule at the database level (CLAUDE.md; locked plan sections 3 and 4), as the
 * privileges CI's guard reads back after this suite. Schema-qualified on purpose: these are the
 * rights on `public`, the schema this file does not own and must not widen.
 */
const APP_ROLE = 'ernav_app'
const PUBLIC_MUST_NOT_HOLD: ReadonlyArray<readonly [table: string, privilege: string]> = [
  ['public."AuditLog"', 'UPDATE'],
  ['public."AuditLog"', 'DELETE'],
  ['public."CaseUpdate"', 'UPDATE'],
  ['public."CaseUpdate"', 'DELETE'],
  ['public."Case"', 'DELETE'],
  ['public."User"', 'DELETE'],
  ['public."Alert"', 'DELETE'],
  ['public."_prisma_migrations"', 'SELECT'],
]

/** A plain dev Postgres has no app role, and `has_table_privilege` on a missing role throws. */
async function appRoleExists(client: PrismaClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') AS present`,
  )
  return rows[0]?.present === true
}

/**
 * Undo, on `public`, what this file's `prisma migrate deploy` just did to it. The statements are
 * prisma/sync-app-role.ts's own revoke list, schema-qualified so nothing depends on a search_path.
 * The last test in this file is what proves it worked. Runs as the owner, on the parent URL.
 */
async function narrowPublicAgain(): Promise<void> {
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: parentUrl! }, { schema: 'public' }),
  })
  try {
    if (!(await appRoleExists(owner))) return
    for (const sql of [
      `REVOKE UPDATE, DELETE ON public."AuditLog" FROM ${APP_ROLE}`,
      `REVOKE UPDATE, DELETE ON public."CaseUpdate" FROM ${APP_ROLE}`,
      `REVOKE DELETE ON public."Case" FROM ${APP_ROLE}`,
      `REVOKE DELETE ON public."User" FROM ${APP_ROLE}`,
      `REVOKE DELETE ON public."Alert" FROM ${APP_ROLE}`,
      `REVOKE ALL ON public."_prisma_migrations" FROM ${APP_ROLE}`,
    ]) {
      await owner.$executeRawUnsafe(sql)
    }
  } finally {
    await owner.$disconnect()
  }
}

let prisma: PrismaClient
let url: string
let env: NodeJS.ProcessEnv

describeDb('the demo seed', () => {
  beforeAll(async () => {
    url = testUrl(parentUrl!)
    // APP_URL is the refusal that can tell production from a demo (see the test below): the
    // lead's own copy is loopback, which the guard allows with or without a label.
    env = {
      ...ENV,
      INSTANCE_LABEL: 'DEMO',
      APP_URL: 'http://localhost:3000',
      DEMO_USER_PASSWORD: PASSWORD,
      DATABASE_URL: url,
    }
    const run = (args: string[]): void => {
      execFileSync(CMD, [...PREFIX, ...args], {
        cwd: ROOT,
        stdio: 'pipe',
        env: {
          ...process.env,
          DATABASE_URL: url,
          ADMIN_USERNAME: 'demoseedadmin',
          ADMIN_PASSWORD: 'demo-seed-test-password',
          ADMIN_DISPLAY_NAME: 'Demo Seed Test',
        },
      })
    }
    run(['exec', 'prisma', 'migrate', 'deploy'])
    // Immediately, before anything else runs: that deploy widened `public`. See the last test.
    await narrowPublicAgain()
    // prisma/seed.ts is what puts the stages, reasons, departments, wards, ED areas and the
    // `system` user in the schema; the demo seed reads them and refuses without them.
    run(['exec', 'tsx', 'prisma/seed.ts'])
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: SCHEMA }) })
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
      await prisma.$disconnect()
    }
  })

  it('refuses without INSTANCE_LABEL', async () => {
    await expect(runDemoSeed({ env: { ...ENV }, prisma })).rejects.toThrow(/INSTANCE_LABEL/)
    expect(await prisma.case.count()).toBe(0)
  })

  it('refuses with a blank or short DEMO_USER_PASSWORD', async () => {
    await expect(
      runDemoSeed({ env: { ...ENV, INSTANCE_LABEL: 'DEMO', DATABASE_URL: url }, prisma }),
    ).rejects.toThrow(/DEMO_USER_PASSWORD/)
    await expect(
      runDemoSeed({ env: { ...env, DEMO_USER_PASSWORD: 'short' }, prisma }),
    ).rejects.toThrow(/DEMO_USER_PASSWORD/)
    expect(await prisma.case.count()).toBe(0)
  })

  /**
   * The refusal that can actually tell the two instances apart, and the reason it exists.
   *
   * `DATABASE_URL`'s hostname is `db` inside the compose project — on production and on the demo
   * alike — so the guard on it never fires in the place the seed is really run from. It catches a
   * hand-typed external URL and nothing else. `APP_URL` is the one value in the container's own
   * environment that names which copy this is (`https://nav.towardpcc.com` there,
   * `https://demo-nav.towardpcc.com` on the demo), `docker exec` inherits it, and a stray
   * `-e INSTANCE_LABEL=DEMO` on the exec line cannot talk the guard out of it.
   */
  it('refuses a production APP_URL even with INSTANCE_LABEL set and a container DATABASE_URL', async () => {
    await expect(
      runDemoSeed({
        env: {
          ...ENV,
          INSTANCE_LABEL: 'DEMO',
          DEMO_USER_PASSWORD: PASSWORD,
          APP_URL: 'https://nav.towardpcc.com',
          DATABASE_URL: 'postgresql://u:p@db:5432/ernav',
        },
        prisma,
      }),
    ).rejects.toThrow(/nav\.towardpcc\.com/)
    expect(await prisma.case.count()).toBe(0)
  })

  it('refuses when APP_URL is missing, so an unlabelled copy cannot be guessed at', async () => {
    const withoutAppUrl: NodeJS.ProcessEnv = { ...env }
    delete withoutAppUrl.APP_URL
    await expect(runDemoSeed({ env: withoutAppUrl, prisma })).rejects.toThrow(/APP_URL/)
    expect(await prisma.case.count()).toBe(0)
  })

  it('refuses without a DATABASE_URL, and refuses production outright', async () => {
    await expect(
      runDemoSeed({
        env: { ...ENV, INSTANCE_LABEL: 'DEMO', APP_URL: 'http://localhost:3000', DEMO_USER_PASSWORD: PASSWORD },
        prisma,
      }),
    ).rejects.toThrow(/DATABASE_URL/)
    await expect(
      runDemoSeed({ env: { ...env, DATABASE_URL: 'postgresql://u:p@nav.towardpcc.com:5432/ernav' }, prisma }),
    ).rejects.toThrow(/nav\.towardpcc\.com/)
  })

  it('creates four users and ten cases, all on the demo MRN prefix', async () => {
    const now = new Date()
    const summary = await runDemoSeed({ env, prisma, now })
    expect(summary).toMatchObject({ users: 4, usersCreated: 4, cases: 10, casesCreated: 10 })

    const users = await prisma.user.findMany({
      where: { username: { in: [...DEMO_USERNAMES] } },
      select: { username: true, role: true, active: true, mustChangePassword: true, email: true },
      orderBy: { username: 'asc' },
    })
    expect(users).toHaveLength(4)
    expect(users.map((u) => u.role).sort()).toEqual(['NAVIGATOR', 'NAVIGATOR', 'SUPERVISOR', 'VIEWER'])
    // Explicitly off, so fifteen people at a demo are not each sent to /account on their first tap.
    expect(users.every((u) => u.mustChangePassword === false)).toBe(true)
    expect(users.every((u) => u.active)).toBe(true)
    // RFC 2606: nothing addressed here can ever leave the host.
    expect(users.every((u) => u.email!.endsWith('@demo.invalid'))).toBe(true)

    const cases = await prisma.case.findMany({ select: { mrn: true } })
    expect(cases).toHaveLength(10)
    expect(cases.every((c) => c.mrn.startsWith(DEMO_MRN_PREFIX))).toBe(true)
    expect(cases.map((c) => c.mrn).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => demoMrn(i + 1)).sort(),
    )
  }, 60_000)

  it('puts an open case in every elapsed band, so the board shows every colour', async () => {
    const now = new Date()
    const open = await prisma.case.findMany({
      where: { status: 'OPEN' },
      select: { status: true, registrationAt: true, departedAt: true, resolvedAt: true },
    })
    expect(open).toHaveLength(6)
    const bands = open.map((c) => band(elapsedHours(c, now))).sort()
    expect(bands).toEqual(['h12', 'h24', 'h4', 'h6', 'ok', 'ok'])
  })

  it('gives the presenter a referral number and an Other description to talk about', async () => {
    const transferred = await prisma.case.findFirstOrThrow({
      where: { disposition: 'TRANSFERRED' },
      select: { referralTrackingNo: true, status: true },
    })
    expect(transferred.status).toBe('RESOLVED')
    expect(transferred.referralTrackingNo).toBeTruthy()

    const other = await prisma.caseReason.findFirst({ where: { NOT: { otherText: null } } })
    expect(other?.otherText).toBeTruthy()
    // The case service queues every Other description; the demo's review queue is not empty.
    expect(await prisma.otherReview.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0)

    // Four resolved across ten days, which clears MIN_N = 3 for the dashboard's 30-day medians.
    expect(await prisma.case.count({ where: { status: 'RESOLVED' } })).toBe(4)
    expect(await prisma.caseUpdate.count()).toBeGreaterThan(8)
  })

  it('is idempotent: a second run adds nothing and changes no password', async () => {
    const before = await prisma.user.findMany({
      where: { username: { in: [...DEMO_USERNAMES] } },
      select: { username: true, passwordHash: true },
      orderBy: { username: 'asc' },
    })
    const summary = await runDemoSeed({ env: { ...env, DEMO_USER_PASSWORD: 'a-completely-different-one' }, prisma })
    expect(summary).toMatchObject({ usersCreated: 0, casesCreated: 0 })
    expect(await prisma.case.count()).toBe(10)
    expect(await prisma.user.count({ where: { username: { in: [...DEMO_USERNAMES] } } })).toBe(4)

    const after = await prisma.user.findMany({
      where: { username: { in: [...DEMO_USERNAMES] } },
      select: { username: true, passwordHash: true },
      orderBy: { username: 'asc' },
    })
    // A reset by hand on the demo instance survives a re-seed.
    expect(after).toEqual(before)
  }, 60_000)

  /**
   * Last, because it needs a foreign row in the schema and puts it back the way it found it. The
   * count is reported; no MRN and no username is.
   */
  it('refuses when the database holds a case that is not the demo’s', async () => {
    const stranger = await prisma.user.create({
      data: {
        username: 'not.a.demo.user',
        displayName: 'Not A Demo User',
        role: 'NAVIGATOR',
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true },
    })
    const theirs = await prisma.case.create({
      data: { mrn: '7001234', registrationAt: new Date(), openedById: stranger.id },
      select: { id: true },
    })

    await expect(runDemoSeed({ env, prisma })).rejects.toThrow(/1 cases opened by someone who is not a demo user/)
    expect(await prisma.case.count()).toBe(11)

    // And the MRN half of the same question, with a demo user as the author.
    const demoAuthor = await prisma.user.findUniqueOrThrow({ where: { username: DEMO_USERNAMES[0]! } })
    await prisma.case.delete({ where: { id: theirs.id } })
    const odd = await prisma.case.create({
      data: { mrn: '7009999', registrationAt: new Date(), openedById: demoAuthor.id },
      select: { id: true },
    })
    await expect(runDemoSeed({ env, prisma })).rejects.toThrow(/whose MRN is not a demo MRN/)

    await prisma.case.delete({ where: { id: odd.id } })
    await prisma.user.delete({ where: { id: stranger.id } })
    expect(await prisma.case.count()).toBe(10)
  }, 60_000)

  /**
   * The reason this file cannot migrate a schema of its own and walk away.
   *
   * `prisma migrate deploy` replays 20260908190100_app_role_privileges here, and that migration's
   * GRANTs name `SCHEMA public` literally while its REVOKEs are unqualified and resolve against the
   * migration's own search_path — this schema. Deploying into any schema but `public` therefore
   * hands `ernav_app` UPDATE and DELETE straight back on `public."AuditLog"` and
   * `public."CaseUpdate"`, plus DELETE on Case, User and Alert and the run of `_prisma_migrations`:
   * the append-only rule, undone by running the test suite. The chain's privilege guard is what
   * caught it; this is the assertion that keeps it caught.
   *
   * The migration itself cannot be corrected — it is applied on production, checksum and all — so
   * `beforeAll` narrows `public` again the moment it has widened it.
   */
  it('leaves the app role’s privileges on public where it found them', async () => {
    if (!(await appRoleExists(prisma))) return
    const held: string[] = []
    for (const [table, privilege] of PUBLIC_MUST_NOT_HOLD) {
      const rows = await prisma.$queryRawUnsafe<Array<{ held: boolean }>>(
        `SELECT has_table_privilege('${APP_ROLE}', '${table}', '${privilege}') AS held`,
      )
      if (rows[0]?.held) held.push(`${privilege} on ${table}`)
    }
    expect(held).toEqual([])
  })
})
