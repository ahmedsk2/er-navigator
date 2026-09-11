import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMEMBER_COOKIE, SESSION_COOKIE, SESSION_TTL_MS } from '@/src/lib/auth/session'

/**
 * proxy.ts deliberately duplicates the cookie name instead of importing it: the gate runs on
 * every request and must not pull Prisma or React into its bundle. This test is what keeps the
 * duplicate honest — rename the cookie in one place and it fails.
 */
const proxy = readFileSync(path.resolve(__dirname, '../../../../proxy.ts'), 'utf8')

describe('the route gate agrees with the session module', () => {
  it('checks the same cookie names and the same lifetime', () => {
    expect(SESSION_COOKIE).toBe('__Host-ern_session')
    expect(REMEMBER_COOKIE).toBe('__Host-ern_remember')
    expect(proxy).toContain(`'${SESSION_COOKIE}'`)
    expect(proxy).toContain(`'${REMEMBER_COOKIE}'`)
    expect(proxy).toContain(`COOKIE_MAX_AGE_S = ${SESSION_TTL_MS / 1000 / 60 / 60} * 60 * 60`)
  })

  it('imports nothing from src/lib', () => {
    expect(proxy).not.toMatch(/from '@\/src\/lib/)
  })

  it('leaves the probes, the login form, the PWA files and the asset pipeline public', () => {
    for (const p of [
      '/login',
      '/api/health',
      '/api/ready',
      '/manifest.webmanifest',
      '/apple-touch-icon.png',
      '/favicon.ico',
      '/robots.txt',
    ]) {
      expect(proxy).toContain(`'${p}'`)
    }
    expect(proxy).toContain(`'/_next/'`)
    expect(proxy).toContain(`'/icons/'`)
  })

  /**
   * Phase 7 moved the Content-Security-Policy out of next.config.ts and into the gate, because it
   * carries a per-request nonce. Two sources would be one source too many: the browser applies
   * the strictest of them and the looser one becomes a lie in the repository. These assertions
   * are the guard on "exactly one place". `tests/e2e/headers.spec.ts` checks what is served.
   */
  it('is the only place a Content-Security-Policy is written', () => {
    expect(proxy).toContain('x-nonce')
    // The directive itself, not the paragraph above it that discusses it.
    const script = /`script-src [^`]*`/.exec(proxy)?.[0] ?? ''
    expect(script).toContain("'self'")
    expect(script).toContain("'nonce-${nonce}'")
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain('unsafe-inline')
    expect(script).not.toContain('unsafe-eval')

    // The header entries in next.config.ts, not the prose explaining why the CSP is not one.
    const config = readFileSync(path.resolve(__dirname, '../../../../next.config.ts'), 'utf8')
    const keys = [...config.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1])
    expect(keys).not.toContain('Content-Security-Policy')
    // The headers that do not need a nonce stay in the config, where they are stated once.
    expect(keys).toContain('Strict-Transport-Security')
    expect(keys).toContain('X-Frame-Options')
  })

  /**
   * `forbidden()` in `requireAction` is only legal with this flag on. Losing it would turn every
   * refused page into a runtime error instead of a 403.
   */
  it('keeps authInterrupts enabled, which is what makes forbidden() legal', () => {
    const config = readFileSync(path.resolve(__dirname, '../../../../next.config.ts'), 'utf8')
    expect(config).toMatch(/authInterrupts:\s*true/)
    const session = readFileSync(path.resolve(__dirname, '../session.ts'), 'utf8')
    expect(session).toContain("import { forbidden, redirect } from 'next/navigation'")
    expect(session).toContain('forbidden()')
  })

  it('never reads the database in the gate', () => {
    expect(proxy).not.toMatch(/prisma|PrismaClient/)
  })

  it('answers a signed-out route handler with 401 instead of redirecting it to an HTML form', () => {
    expect(proxy).toContain(`pathname.startsWith('/api/')`)
    expect(proxy).toContain('status: 401')
  })

  /**
   * A cookie whose session is gone — deactivated, expired, logged out elsewhere — reaches the
   * page, which redirects to /login?expired=1. Only the gate can clear a cookie, so it must
   * recognise that parameter; if it did not, it would send the browser straight back and the two
   * would redirect at each other forever.
   */
  it('clears the cookie on /login?expired instead of bouncing back to the board', () => {
    expect(proxy).toContain(`searchParams.has('expired')`)
    expect(proxy).toContain('cookieAttrs(0)')
    const session = readFileSync(path.resolve(__dirname, '../session.ts'), 'utf8')
    expect(session).toContain(`redirect('/login?expired=1')`)
  })
})

/**
 * Phase 12 item 5 (P12): the must-change exemption, and where it may appear.
 *
 * The first attempt at this rule compared the request path, stamped into `x-pathname` by the
 * gate. It is wrong, and the way it is wrong is worth keeping written down: Next renders a server
 * action's redirect DESTINATION inside the action's own POST request, so while `/account` is
 * being rendered the header still says `/login`. The guard fires, the router is handed a payload
 * whose URL and tree disagree, and the browser refetches `/account` for ever — a blank page that
 * never settles, which is what the real sign-in in `tests/e2e/auth.spec.ts` caught.
 *
 * So the exemption is an argument, `allowMustChange`, and this is the grep that keeps it to the
 * two callers that together are the render of /account. Deliberately dumb, in the spirit of
 * `page-guards.test.ts`: a third caller fails this test.
 */
describe('the must-change exemption', () => {
  const ROOT = path.resolve(__dirname, '../../../..')
  const session = readFileSync(path.join(ROOT, 'src/lib/auth/session.ts'), 'utf8')

  function walk(dir: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) found.push(...walk(full))
      else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) found.push(full)
    }
    return found
  }

  it('enforces by default and redirects to exactly one path', () => {
    expect(session).toContain("export const ACCOUNT_PATH = '/account'")
    expect(session).toContain('redirect(ACCOUNT_PATH)')
    expect(session).toContain('if (opts.allowMustChange) return')
    // An API caller is refused before the exemption is even consulted.
    const guard = session.slice(session.indexOf('function assertPasswordChanged'))
    expect(guard.indexOf('UnauthorizedError')).toBeLessThan(guard.indexOf('allowMustChange'))
  })

  it('is passed by the (app) layout and the account page, and by nothing else', () => {
    const callers = walk(path.join(ROOT, 'app'))
      .filter((f) => readFileSync(f, 'utf8').includes('allowMustChange'))
      .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
      .sort()
    expect(callers).toEqual(['app/(app)/account/page.tsx', 'app/(app)/layout.tsx'])
  })

  it('is not smuggled in through src/', () => {
    const callers = walk(path.join(ROOT, 'src'))
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => readFileSync(f, 'utf8').includes('allowMustChange'))
      .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
    expect(callers).toEqual(['src/lib/auth/session.ts'])
  })

  it('sends a must-change account straight to /account at sign-in', () => {
    // The other half of the same Next behaviour: a redirect out of the action's destination
    // render loops exactly as the header did.
    const login = readFileSync(path.join(ROOT, 'app/login/actions.ts'), 'utf8')
    expect(login).toContain('mustChangePassword')
    expect(login).toContain('redirect(ACCOUNT_PATH)')
  })

  it('left no x-pathname behind in the gate', () => {
    expect(proxy).not.toContain('x-pathname')
  })
})
