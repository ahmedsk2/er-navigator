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
 * Three exports are allowed neither: signing in, signing out and changing your own password.
 * They are listed by name below with the reason, so adding a fourth is a deliberate edit to this
 * file rather than an omission nobody notices.
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
      'app/login/actions.ts',
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

  it('lists every session-only exemption with a reason', () => {
    for (const [key, reason] of SESSION_ACTIONS) {
      const [relative, name] = key.split(':') as [string, string]
      const source = readFileSync(path.join(ROOT, relative), 'utf8')
      expect(source, `${key} is exempt but no longer exists`).toContain(`export async function ${name}(`)
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(20)
    }
    expect(SESSION_ACTIONS.size, 'a new exemption is a decision, not an oversight').toBe(3)
  })
})
