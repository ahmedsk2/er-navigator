import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDemoTarget, DemoTargetError, PRODUCTION_HOSTS } from '@/src/lib/demo-guard'

/**
 * Phase 12 item 2 (D3). One run of the demo tooling against the live database would put invented
 * patients there permanently: the audit log is append-only and cases can only be voided.
 */
const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars })

describe('assertDemoTarget', () => {
  it('refuses production even with INSTANCE_LABEL set', () => {
    expect(() => assertDemoTarget('https://nav.towardpcc.com', env({ INSTANCE_LABEL: 'DEMO' }))).toThrow(
      DemoTargetError,
    )
  })

  it('refuses production on any path, port or scheme', () => {
    for (const url of [
      'https://nav.towardpcc.com/login',
      'https://nav.towardpcc.com:3000/',
      'http://NAV.TOWARDPCC.COM/',
    ]) {
      expect(() => assertDemoTarget(url, env({ INSTANCE_LABEL: 'DEMO' })), url).toThrow(DemoTargetError)
    }
  })

  it('allows loopback with no label at all', () => {
    expect(() => assertDemoTarget('http://localhost:3300', env())).not.toThrow()
    expect(() => assertDemoTarget('http://127.0.0.1:3300', env())).not.toThrow()
    expect(() => assertDemoTarget('http://[::1]:3300', env())).not.toThrow()
  })

  it('allows another host only when this process is labelled', () => {
    expect(() => assertDemoTarget('https://demo-nav.towardpcc.com', env())).toThrow(DemoTargetError)
    expect(() =>
      assertDemoTarget('https://demo-nav.towardpcc.com', env({ INSTANCE_LABEL: 'DEMO' })),
    ).not.toThrow()
  })

  /**
   * Why `scripts/demo-seed.ts` cannot rely on the database URL alone (Phase 12 review round).
   * Inside the compose project the database host is `db` on production and on the demo alike, so
   * this guard, handed only that URL, passes on both — it can only judge what it is given. The
   * seed therefore also puts `APP_URL`, the one value in the container's own environment that
   * names which copy it is, through this same function.
   */
  it('cannot tell production from a demo by a compose-internal database host', () => {
    expect(() => assertDemoTarget('postgresql://u:p@db:5432/ernav', env({ INSTANCE_LABEL: 'DEMO' }))).not.toThrow()
  })

  it('refuses an unparseable target', () => {
    expect(() => assertDemoTarget('not a url', env({ INSTANCE_LABEL: 'DEMO' }))).toThrow(DemoTargetError)
    expect(() => assertDemoTarget('', env({ INSTANCE_LABEL: 'DEMO' }))).toThrow(DemoTargetError)
  })

  it('names the production host it is protecting', () => {
    expect(PRODUCTION_HOSTS).toContain('nav.towardpcc.com')
  })
})

/**
 * The third refusal is in shell (`scripts/demo-reset.sh`), because a shell script cannot import
 * the module above. Its guard is only worth having if a syntax error in it fails CI rather than
 * shipping, and that script was not on the "shell scripts parse" list.
 */
describe('scripts/demo-reset.sh', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const script = readFileSync(path.join(ROOT, 'scripts/demo-reset.sh'), 'utf8')
  const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')

  it('is parsed by CI', () => {
    expect(ci).toContain('bash -n scripts/demo-reset.sh')
  })

  it('refuses the production Postgres port and states the loopback rule', () => {
    expect(script).toContain('DEV_DB_PORT')
    expect(script).toContain('127.0.0.1')
    expect(script).toContain('INSTANCE_LABEL')
  })

  it('tests the URL by pattern and never echoes it', () => {
    expect(script).toMatch(/case "\$OWNER" in/)
    expect(script).not.toMatch(/echo[^\r\n]*\$OWNER/)
  })
})
