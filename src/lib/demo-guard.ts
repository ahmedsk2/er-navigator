/**
 * "Is this a copy I am allowed to fill with invented patients?" (Phase 12 item 2, audit D3.)
 *
 * One rule, in one place, imported by both things that could point at the wrong database: the
 * demo Playwright config (`tests/demo/playwright.demo.config.ts`) and the demo seed
 * (`scripts/demo-seed.ts`). `scripts/demo-reset.sh` states the same rule in shell, in its header,
 * because a shell script cannot import this.
 *
 * The order matters and is asserted, over the URL it is handed:
 *  1. a production host throws, always, even with INSTANCE_LABEL set — no environment variable
 *     may talk the tooling into writing to `nav.towardpcc.com`;
 *  2. loopback passes with no label, because a laptop database is nobody's record;
 *  3. any other host passes only when this process carries an instance label, which is how the
 *     hosted demo identifies itself;
 *  4. anything that is not a URL throws, rather than being treated as "not production".
 *
 * IT CAN ONLY JUDGE THE URL IT IS GIVEN, and which URL that is decides whether it is a barrier at
 * all (corrected in the Phase 12 review round). The Playwright config hands it a base URL, which
 * is exactly the thing that would point at production. The seed runs *inside* the app container,
 * where `DATABASE_URL`'s hostname is `db` on production and on the demo alike — so that URL alone
 * can never distinguish them, and the seed therefore also puts `APP_URL`, the container's own
 * address, through this function. `scripts/demo-seed.ts` says which of its refusals is load
 * bearing and why.
 *
 * A run against the live database would be permanent: the audit log is append-only and a case can
 * only be voided, never deleted.
 */
import { instanceLabel } from '@/src/lib/instance'

export const PRODUCTION_HOSTS = ['nav.towardpcc.com'] as const

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const

export class DemoTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoTargetError'
  }
}

export function assertDemoTarget(url: string, env: NodeJS.ProcessEnv = process.env): void {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    throw new DemoTargetError(`refusing: "${url}" is not a URL, so it cannot be checked against production`)
  }

  // `new URL('http://[::1]:3300').hostname` is '[::1]'; a bare '::1' can only arrive from a
  // hand-built string. Both are the same machine.
  if (PRODUCTION_HOSTS.some((h) => h === host)) {
    throw new DemoTargetError(`refusing: ${host} is the production instance`)
  }
  if (LOOPBACK_HOSTS.some((h) => h === host)) return
  if (instanceLabel(env) !== null) return

  throw new DemoTargetError(
    `refusing: ${host} is neither loopback nor a labelled instance (set INSTANCE_LABEL to say this copy is a demo)`,
  )
}
