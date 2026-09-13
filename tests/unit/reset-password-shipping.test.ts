import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P15.63. The host-side password reset is the tool reached for when nobody can sign in, which is
 * the worst possible moment to discover it is not in the image: the app boots, the deploy is
 * green, and `node reset-password.js` says "Cannot find module".
 *
 * So this is the same dumb grep `demo-seed-shipping.test.ts` runs over the four files that have
 * to agree, following `worker.js` and `demo-seed.js` exactly.
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8')

const pkg = read('package.json')
const dockerfile = read('Dockerfile')
const ci = read('.github/workflows/ci.yml')

describe('the host-side password reset ships with the image', () => {
  it('has an esbuild script beside the worker and demo-seed bundles', () => {
    expect(pkg).toContain('"build:reset-password"')
    expect(pkg).toContain('scripts/reset-password.ts')
    expect(pkg).toContain('--outfile=dist/reset-password.js')
  })

  it('is bundled in the Docker build stage', () => {
    expect(dockerfile).toContain('pnpm run build:reset-password')
  })

  it('is copied into the runner image beside worker.js and demo-seed.js', () => {
    expect(dockerfile).toContain('/repo/dist/reset-password.js ./reset-password.js')
    // The pattern it copies, still there.
    expect(dockerfile).toContain('/repo/dist/demo-seed.js ./demo-seed.js')
  })

  it('is built in CI, so a bundle that stops building is not a failed deploy', () => {
    expect(ci).toContain('pnpm run build:reset-password')
  })

  it('is the procedure the runbook gives, so nobody re-hashes a password by hand again', () => {
    const runbook = read('docs/RUNBOOK.md')
    expect(runbook).toContain('node reset-password.js')
    // The hand-written bcrypt + SQL that this replaced must not come back.
    expect(runbook).not.toContain('bcrypt.hashpw')
  })
})
