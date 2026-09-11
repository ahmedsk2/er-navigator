import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 12 item 3. The demo seed is only useful if it is actually inside the image the demo
 * instance runs, and nothing else would notice if it fell out: the app boots, the deploy is green,
 * and `node demo-seed.js` says "Cannot find module" on the day of the demo.
 *
 * So this is a dumb grep over the four files that have to agree, in the spirit of
 * `page-guards.test.ts`. It follows `worker.js` exactly, which is the pattern it copies.
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8')

const pkg = read('package.json')
const dockerfile = read('Dockerfile')
const ci = read('.github/workflows/ci.yml')

describe('the demo seed ships with the image', () => {
  it('has an esbuild script beside the worker bundle', () => {
    expect(pkg).toContain('"build:demo-seed"')
    expect(pkg).toContain('scripts/demo-seed.ts')
    expect(pkg).toContain('--outfile=dist/demo-seed.js')
  })

  it('is bundled in the Docker build stage', () => {
    expect(dockerfile).toContain('pnpm run build:demo-seed')
  })

  it('is copied into the runner image beside worker.js', () => {
    expect(dockerfile).toContain('/repo/dist/demo-seed.js ./demo-seed.js')
    // The pattern it copies, still there.
    expect(dockerfile).toContain('/repo/dist/worker.js ./worker.js')
  })

  it('is built in CI, so a bundle that stops building is not a failed deploy', () => {
    expect(ci).toContain('pnpm run build:demo-seed')
    expect(ci).toContain('pnpm run build:worker')
  })

  it('is not committed: dist/ is ignored', () => {
    expect(read('.gitignore')).toMatch(/^dist\/$/m)
  })
})
