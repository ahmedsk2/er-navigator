import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The entrypoint strips every environment variable that is not on one allowlist line, because
 * Coolify attaches the whole application environment — the database OWNER password included — to
 * every compose service. A runtime variable the app reads but the allowlist does not name is
 * therefore not "defaulted": it is silently gone by the time the server starts, and a demo
 * instance would behave exactly like production while its Coolify page says otherwise.
 *
 * Deliberately dumb, in the spirit of tests/unit/page-guards.test.ts: it greps the two files that
 * have to agree rather than reasoning about them.
 */
const ROOT = path.resolve(__dirname, '../..')
const entrypoint = readFileSync(path.join(ROOT, 'docker/entrypoint.sh'), 'utf8')
const compose = readFileSync(path.join(ROOT, 'docker-compose.production.yml'), 'utf8')

const keepLine = entrypoint.match(/^KEEP="([^"]*)"$/m)?.[1] ?? ''
const keep = keepLine.trim().split(/\s+/)

/** Every variable the app process reads at runtime and cannot be given a build-time default. */
const RUNTIME_VARS = ['REPORT_HEADER', 'INSTANCE_LABEL', 'LOGIN_RATE_LIMIT_PER_MINUTE'] as const

describe('docker/entrypoint.sh KEEP allowlist', () => {
  it('is one quoted, space-padded line', () => {
    expect(keepLine.startsWith(' ')).toBe(true)
    expect(keepLine.endsWith(' ')).toBe(true)
  })

  for (const name of RUNTIME_VARS) {
    it(`keeps ${name}`, () => {
      expect(keep).toContain(name)
    })
  }
})

describe('docker-compose.production.yml', () => {
  const app = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  worker:'))

  for (const name of RUNTIME_VARS) {
    it(`defaults ${name} on the app service`, () => {
      const line = app
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${name}:`))
      expect(line, `${name} is not on the app service`).toBeDefined()
      // `${VAR}` or `${VAR:-default}`, the shape every other variable on this service uses, so
      // an unset variable is empty rather than a compose interpolation warning.
      expect(line!.startsWith(`${name}: \${${name}}`) || line!.startsWith(`${name}: \${${name}:-`)).toBe(true)
    })
  }

  it('puts neither on the worker: it renders nothing and it has no login form', () => {
    const worker = compose.slice(compose.indexOf('\n  worker:'))
    expect(worker).not.toContain('INSTANCE_LABEL')
    expect(worker).not.toContain('LOGIN_RATE_LIMIT_PER_MINUTE')
  })

  it('deliberately leaves DEMO_USER_PASSWORD off the allowlist', () => {
    // It is passed on the `docker exec` line of the demo seed and never lives in the app process:
    // `docker exec` does not run the ENTRYPOINT, so nothing there strips it.
    expect(keep).not.toContain('DEMO_USER_PASSWORD')
    expect(compose).not.toContain('DEMO_USER_PASSWORD')
  })
})
