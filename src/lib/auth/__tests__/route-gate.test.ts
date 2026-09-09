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

  it('leaves the probes, the login form and the asset pipeline public', () => {
    for (const p of ['/login', '/api/health', '/api/ready', '/manifest.webmanifest', '/favicon.ico', '/robots.txt']) {
      expect(proxy).toContain(`'${p}'`)
    }
    expect(proxy).toContain(`'/_next/'`)
    expect(proxy).toContain(`'/icons/'`)
  })

  it('never reads the database in the gate', () => {
    expect(proxy).not.toMatch(/prisma|PrismaClient/)
  })

  it('answers a signed-out route handler with 401 instead of redirecting it to an HTML form', () => {
    expect(proxy).toContain(`pathname.startsWith('/api/')`)
    expect(proxy).toContain('status: 401')
  })
})
