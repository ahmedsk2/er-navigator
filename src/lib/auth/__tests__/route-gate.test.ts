import { readFileSync } from 'node:fs'
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
    expect(SESSION_COOKIE).toBe('ern_session')
    expect(REMEMBER_COOKIE).toBe('ern_remember')
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
