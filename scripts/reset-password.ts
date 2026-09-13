/**
 * Reset one account's password from the host (Phase 15, P15.63).
 *
 * WHY IT EXISTS. Admin → Users resets a password in two taps, and that is how it is done on a
 * normal day. It cannot answer the one case it does not cover: nobody can sign in as an ADMIN —
 * every administrator locked out at once, or the admin password lost. Until now the runbook
 * answered that with a hand-written bcrypt hash and a hand-written UPDATE plus a hand-written
 * AuditLog INSERT, run as the owner role. That is four places to get wrong at three in the
 * morning, and it wrote a row the application would never have written.
 *
 * SHIPPED LIKE THE WORKER AND THE DEMO SEED. esbuild bundles this file to `dist/reset-password.js`
 * in the Docker build stage and the runner image carries it beside `worker.js` and
 * `demo-seed.js`; it runs with plain `node` inside the app container, which has no package
 * manager, no TypeScript and no node_modules. `docker exec` does not run the image's ENTRYPOINT,
 * so the allowlist does not strip what is passed on the exec line and the owner URL never has to
 * live in the container's environment:
 *
 *   sudo docker exec -e DATABASE_URL="$OWNER_URL" "$APPC" node reset-password.js <username>
 *
 * `$OWNER_URL` is the URL the `migrate` service uses (docs/RUNBOOK.md, "Reset a password from the
 * host"). The app role would do for the UPDATE, but the owner is the role the runbook already
 * has to hand for work like this and it is the one that cannot be short of a privilege.
 *
 * THAT `-e` OVERRIDES RATHER THAN SUPPLIES (corrected in P15.64, measured on the live container).
 * The app container carries a `DATABASE_URL` of its own — the app role — and `docker exec`
 * inherits it, so leaving the `-e` off does not reach the refusal below: it runs as the app role,
 * which has every privilege this needs, since Admin → Users runs the same reset as that role. The
 * `DATABASE_URL` refusal is for running the bundle outside a container.
 *
 * NO DEMO CONDITION, deliberately, unlike `demo-seed.ts`. This is the production lockout tool;
 * refusing to run on production would remove its only reason to exist. It writes exactly what
 * Admin → Users writes — see `src/lib/auth/password-reset.ts` — so the worst it can do is hand
 * out a temporary password and sign one person out.
 *
 * IT REFUSES, each refusal a non-zero exit and a plain message:
 *   - no username on the command line: it prints the usage and exits 2;
 *   - DATABASE_URL is not set;
 *   - no user with that username (active or inactive — a deactivated account is reset here so
 *     that reactivating it in the screen is all that is left to do);
 *   - the `system` account, which has no password to reset and can never sign in;
 *   - the `system` user row is missing, so there is no actor to put on the audit row.
 *
 * IT PRINTS ONE LINE on success — the username and the temporary password, separated by a
 * space — and nothing else. The password is not written to the audit row, to a log or to the
 * database in plain text, and it cannot be recovered afterwards: read it out, then have the
 * person sign in and set their own, which the `mustChangePassword` flag forces at once.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { AuditContext } from '../src/lib/audit'
import { prismaPasswordResetStore, resetPassword } from '../src/lib/auth/password-reset'
import { SYSTEM_USERNAME } from '../src/lib/auth/system-user'

export const USAGE = 'usage: node reset-password.js <username>'

/** The audit row's user agent, as `alerts-worker` is the worker's. */
export const RESET_USER_AGENT = 'reset-password (host)'

export class ResetPasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResetPasswordError'
  }
}

/** Thrown when there is no username to act on; `main` prints the usage and exits 2. */
export class ResetPasswordUsageError extends ResetPasswordError {
  constructor() {
    super(USAGE)
    this.name = 'ResetPasswordUsageError'
  }
}

function refuse(message: string): never {
  throw new ResetPasswordError(`[reset-password] refusing: ${message}`)
}

export type ResetPasswordDeps = {
  env?: NodeJS.ProcessEnv
  /** The arguments after the script name; `process.argv.slice(2)` on the process path. */
  argv?: string[]
  /** Injected by the database test, which owns the connection. */
  prisma?: PrismaClient
  /** Where the one line goes. The test collects it instead of printing it. */
  out?: (line: string) => void
}

export type ResetPasswordSummary = {
  username: string
  temporaryPassword: string
  sessionsDeleted: number
}

/** `${username} ${temporaryPassword}` — one line, two fields, nothing to strip before typing. */
export function resetLine(username: string, temporaryPassword: string): string {
  return `${username} ${temporaryPassword}`
}

export async function runPasswordReset(deps: ResetPasswordDeps = {}): Promise<ResetPasswordSummary> {
  const env = deps.env ?? process.env
  const argv = deps.argv ?? process.argv.slice(2)
  const out = deps.out ?? ((line: string) => console.log(line))

  // Usernames are stored lower case and the login form lower-cases what is typed into it
  // (`loginUsernameSchema`), so the same courtesy here: `Sami` finds `sami`.
  const username = (argv[0] ?? '').trim().toLowerCase()
  if (!username) throw new ResetPasswordUsageError()
  if (argv.length > 1) refuse('one username at a time')

  const url = env.DATABASE_URL ?? ''
  if (!url) refuse('DATABASE_URL is not set')

  if (username === SYSTEM_USERNAME) {
    refuse(`the "${SYSTEM_USERNAME}" account has no password to reset — it can never sign in`)
  }

  // Built after the refusals, so a bad command line never opens a connection.
  const ownClient = deps.prisma ? null : new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const prisma = deps.prisma ?? ownClient!
  try {
    const target = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
    if (!target) refuse(`there is no user "${username}"`)

    // The actor on the audit row. The reset happens from the host with nobody signed in, so it is
    // the `system` user, exactly as the alerts worker's rows are.
    const system = await prisma.user.findUnique({ where: { username: SYSTEM_USERNAME }, select: { id: true } })
    if (!system) {
      refuse(`the "${SYSTEM_USERNAME}" user is missing — run the seed (prisma/seed.ts) before this script`)
    }

    const ctx: AuditContext = { actorId: system.id, ip: null, userAgent: RESET_USER_AGENT }
    const { temporaryPassword, sessionsDeleted } = await resetPassword(
      prismaPasswordResetStore(ctx, prisma),
      target,
      { by: 'host' },
    )

    out(resetLine(target.username, temporaryPassword))
    return { username: target.username, temporaryPassword, sessionsDeleted }
  } finally {
    if (ownClient) await ownClient.$disconnect().catch(() => undefined)
  }
}

/** The process wrapper. `runPasswordReset` takes every dependency, so the test never comes here. */
async function main(): Promise<void> {
  try {
    await runPasswordReset()
  } catch (error: unknown) {
    if (error instanceof ResetPasswordUsageError) {
      console.error(USAGE)
      process.exit(2)
    } else {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  }
}

// `require.main === module` under the cjs bundle esbuild produces; never true when the database
// test imports this file through vitest.
if (require.main === module) {
  void main()
}
