import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Locked plan section 7: "role checks server-side on every server action". This is the grep that
 * enforces it, in the spirit of `route-gate.test.ts` — deliberately dumb, so it cannot be argued
 * with and cannot be forgotten.
 *
 * Every function exported from an `app/**\/actions.ts` file is a server action: Next turns it
 * into a POST endpoint that anyone with a session cookie can call directly, whatever the screen
 * offers. So each one must, in its own source (helpers in the same file counted):
 *
 *   - call `requireAction(...)`, which checks the permission matrix itself; or
 *   - call `requireUser()` / `getSession()` AND hand the actor to a service under `src/lib/`
 *     that calls `assertCan(...)` — the shape this app actually uses, because the service is
 *     where the one `auth.forbidden` audit row is written and where the database tests reach.
 *
 * Five exports are allowed neither: signing in, signing out, changing your own password, and the
 * two halves of the Phase 16 password reset. They are listed by name below with the reason, so
 * adding a sixth is a deliberate edit to this file rather than an omission nobody notices.
 */
const ROOT = path.resolve(__dirname, '../..')
const APP = path.join(ROOT, 'app')

/** Actions whose subject is the caller's own session, so there is no permission to check. */
const SESSION_ACTIONS = new Map<string, string>([
  ['app/login/actions.ts:login', 'the sign-in door itself: it runs before there is a session'],
  ['app/(app)/actions.ts:logout', 'ends the caller’s own session; every role may sign out'],
  [
    'app/(app)/account/actions.ts:changeMyPassword',
    'changes the caller’s own password, after re-checking their current one',
  ],
  /**
   * Phase 16 (docs/specs/phase16-forgot-password.md). Both run before there is a session, exactly
   * as `login` does, and both are public by design: proxy.ts lists /forgot and /reset beside
   * /login. What stands in for a permission check is stated in each file and asserted below —
   * `requestReset` answers one sentence whatever it decides, so it cannot be used to learn
   * whether an account exists, and `completeReset` refuses everything but a live one-time token.
   */
  [
    'app/forgot/actions.ts:requestReset',
    'the public "forgot my password" form: it runs before there is a session, and answers the same sentence whatever it decides',
  ],
  [
    'app/reset/actions.ts:completeReset',
    'spends a one-time emailed token, which is the only credential there is at this point: there is no session yet',
  ],
])

function actionFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...actionFiles(full))
    else if (entry === 'actions.ts') found.push(full)
  }
  return found.sort()
}

type Fn = { name: string; body: string }

/**
 * Every top-level function in the file, exported or not, with its body.
 *
 * The body runs from the `{` that opens it to the first `}` in column 0, which is where Prettier
 * puts the closing brace of a top-level function. A signature's return type can contain a brace
 * (`Promise<{ ok: boolean }>`), so the body's opening brace is found as the first `{` that ends
 * its line. Every export must yield a body; a file this cannot parse fails the test rather than
 * passing it silently.
 */
function functionsIn(source: string): { exported: Fn[]; helpers: Fn[] } {
  const exported: Fn[] = []
  const helpers: Fn[] = []
  const pattern = /^(export )?(async )?function ([A-Za-z_$][\w$]*)/gm
  for (const match of source.matchAll(pattern)) {
    const start = match.index
    const opening = source.slice(start).search(/\{\r?\n/)
    expect(opening, `could not find the body of ${match[3]}`).toBeGreaterThan(0)
    const bodyStart = start + opening
    const end = source.indexOf('\n}', bodyStart)
    expect(end, `could not find the end of ${match[3]}`).toBeGreaterThan(bodyStart)
    const fn: Fn = { name: match[3]!, body: source.slice(bodyStart, end) }
    if (match[1]) exported.push(fn)
    else helpers.push(fn)
  }
  return { exported, helpers }
}

/** The action's own body plus the body of every same-file helper it calls. */
function reachableSource(fn: Fn, helpers: Fn[]): string {
  const used = helpers.filter((helper) => new RegExp(`\\b${helper.name}\\s*\\(`).test(fn.body))
  return [fn.body, ...used.map((helper) => helper.body)].join('\n')
}

/** `@/src/lib/...` modules this file imports, resolved to their source. */
function importedLibSources(source: string): Array<{ specifier: string; text: string }> {
  const out: Array<{ specifier: string; text: string }> = []
  for (const match of source.matchAll(/from '(@\/src\/lib\/[^']+)'/g)) {
    const specifier = match[1]!
    const file = path.join(ROOT, `${specifier.replace('@/', '')}.ts`)
    out.push({ specifier, text: readFileSync(file, 'utf8') })
  }
  return out
}

const files = actionFiles(APP)

describe('every server action checks the caller server-side', () => {
  it('finds the action files (a rename must not make this test vacuous)', () => {
    const names = files.map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
    expect(names).toEqual([
      'app/(app)/account/actions.ts',
      'app/(app)/actions.ts',
      'app/(app)/admin/actions.ts',
      'app/cases/actions.ts',
      'app/forgot/actions.ts',
      'app/login/actions.ts',
      'app/reset/actions.ts',
    ])
  })

  it.each(files.map((file) => [path.relative(ROOT, file).replaceAll('\\', '/'), file] as const))(
    '%s',
    (relative, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source.startsWith("'use server'"), `${relative} must start with 'use server'`).toBe(true)

      const { exported, helpers } = functionsIn(source)
      expect(exported.length, `${relative} exports no function`).toBeGreaterThan(0)

      // A server action written as an arrow constant would be invisible to functionsIn() and
      // therefore unchecked. Refuse the shape rather than parse it (final review, tests lens).
      expect(
        /^export const [A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\(|[A-Za-z_$][\w$]*\s*=>)/m.test(source),
        `${relative}: write server actions as function declarations so this guard sees them`,
      ).toBe(false)

      const libs = importedLibSources(source)
      // A guarded service is one that CALLS assertCan on the actor it is handed. The module that
      // DEFINES assertCan (src/lib/auth/session.ts) exports requireUser and friends too, and
      // counting it would let `await requireUser()` alone satisfy this test (final review C12).
      const guardedServices = libs.filter(
        (lib) => /\bawait assertCan\s*\(/.test(lib.text) && !/^export async function assertCan\b/m.test(lib.text),
      )
      expect(guardedServices.map((lib) => lib.specifier)).not.toContain('@/src/lib/auth/session')

      for (const fn of exported) {
        const key = `${relative}:${fn.name}`
        if (SESSION_ACTIONS.has(key)) continue
        const reachable = reachableSource(fn, helpers)

        const checksMatrixItself = /\brequireAction\s*\(/.test(reachable)
        const hasSession = /\brequireUser\s*\(|\bgetSession\s*\(/.test(reachable)
        expect(
          checksMatrixItself || hasSession,
          `${key} reaches neither requireAction nor requireUser/getSession`,
        ).toBe(true)
        if (checksMatrixItself) continue

        // Authenticated but not authorised here: the permission must be checked by a service it
        // hands the actor to. `assertCan` is what writes the auth.forbidden audit row.
        const delegates = guardedServices.some((lib) => {
          const name = lib.specifier.split('/').pop()!
          return (
            new RegExp(`\\b${name}\\.[A-Za-z_$][\\w$]*\\s*\\(`).test(fn.body) ||
            [...lib.text.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)].some((m) =>
              new RegExp(`\\b${m[1]}(Service)?\\s*\\(`).test(fn.body),
            )
          )
        })
        expect(
          delegates,
          `${key} has a session check but calls no service that calls assertCan`,
        ).toBe(true)
      }
    },
  )

  /**
   * Phase 15, item 10. A server action is a POST endpoint Next generates an id for, so one with
   * no screen behind it is reachable surface for nothing. `addCaseUpdate` lost its only caller
   * when Phase 14 took the Updates composer off the case page, and it is retired here.
   *
   * The service function stays, with its `case.update.add` permission check, its zod parse and
   * its audit row: `tests/db/cases.test.ts` drives it, `mirrorDelayAction` appends through the
   * same table, and Ahmed asked for the section to be hidden, not for the ability to append to
   * be removed. This asserts both halves, so neither can be undone by accident.
   */
  it('exports exactly the case mutations the case page calls, and no orphan endpoint', () => {
    const actions = readFileSync(path.join(ROOT, 'app/cases/actions.ts'), 'utf8')
    expect(functionsIn(actions).exported.map((fn) => fn.name).sort()).toEqual([
      'acknowledgeAlert',
      'createCase',
      'reopenCase',
      'resolveCase',
      'reviewCase',
      'saveCase',
      'voidCase',
    ])
    const service = readFileSync(path.join(ROOT, 'src/lib/cases/service.ts'), 'utf8')
    expect(service, 'the append-an-update writer must stay').toMatch(/^export async function addCaseUpdate\b/m)
    expect(service).toMatch(/assertCan\(actor, 'case\.update\.add', ctx\)/)
  })

  it('lists every session-only exemption with a reason', () => {
    for (const [key, reason] of SESSION_ACTIONS) {
      const [relative, name] = key.split(':') as [string, string]
      const source = readFileSync(path.join(ROOT, relative), 'utf8')
      expect(source, `${key} is exempt but no longer exists`).toContain(`export async function ${name}(`)
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(20)
    }
    expect(SESSION_ACTIONS.size, 'a new exemption is a decision, not an oversight').toBe(5)
  })

  /**
   * Phase 16. The two exemptions above are only defensible while the properties that stand in for
   * a permission check hold, so they are asserted here rather than taken on the reason string.
   *
   * `requestReset` must have exactly one return shape — a form that answered differently for an
   * account that exists would be an enumeration oracle on a public page — and both actions must
   * pass through the rate limiter, because a public endpoint that writes to the database and
   * sends mail is otherwise a free amplifier.
   */
  it('keeps the two public reset actions to one answer and behind the rate limiter', () => {
    const forgot = readFileSync(path.join(ROOT, 'app/forgot/actions.ts'), 'utf8')
    const reset = readFileSync(path.join(ROOT, 'app/reset/actions.ts'), 'utf8')

    for (const [name, source] of [['forgot', forgot], ['reset', reset]] as const) {
      expect(source, `${name} does not rate limit`).toMatch(/passwordResetRateLimiter\.check\(/)
      // The sign-in bucket must not be the one being spent: a nurse who has just failed to sign
      // in five times is exactly the person who needs this form to answer.
      expect(source, `${name} spends the sign-in bucket`).not.toMatch(/loginRateLimiter/)
      // P16.41: and one answer is not enough on its own, because a sentence delivered in 1 ms
      // and the same sentence delivered in 10 are two answers. Both actions open with the floor.
      expect(source, `${name} does not hold every outcome to the same floor`).toMatch(
        /return withConstantTimeFloor\(async \(\) => \{/,
      )
    }

    // Every `return` in requestReset is the same object. Anything else is a difference an
    // attacker can measure.
    const body = forgot.slice(forgot.indexOf('export async function requestReset'))
    const returns = [...body.matchAll(/\breturn (.+)$/gm)].map((m) => m[1]!.trim())
    // The outer one is the P16.41 envelope; every return inside it is the one answer.
    expect(returns[0]).toBe('withConstantTimeFloor(async () => {')
    const answers = returns.slice(1)
    expect(answers.length).toBeGreaterThan(1)
    expect(new Set(answers)).toEqual(new Set(['{ sent: true }']))

    // And the reset action gives one outcome for a token that cannot be spent, whatever was
    // wrong with it.
    expect(reset).toMatch(/error: 'invalid'/)
    expect(reset, 'a used token must not be distinguishable from an expired one').not.toMatch(
      /error: '(expired|used|unknown_token)'/,
    )
  })
})
