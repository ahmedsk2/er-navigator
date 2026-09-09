import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 7 review C1: a layout is not a gate.
 *
 * Next skips ancestor layouts on an RSC (soft-navigation) request whose `next-router-state-tree`
 * already contains the segment — `walkTreeWithFlightRouterState` computes
 * `renderComponentsOnThisLevel` as false for every segment the client says it already has, and
 * calls `createComponentTree` on the sliced subtree only. So for four of the six `/admin` pages
 * the shared `admin/layout.tsx` was the ONLY ADMIN check, and it never ran.
 *
 * This is the grep that stops it coming back, in the spirit of `server-actions.test.ts`:
 * deliberately dumb, so it cannot be argued with and cannot be forgotten. A new page under
 * `/admin` fails this test until it checks the caller itself. `tests/e2e/admin.spec.ts` proves
 * the same thing end to end, over the real RSC request; this one fails in a second, with no
 * database and no browser.
 */
const ROOT = path.resolve(__dirname, '../..')
const ADMIN = path.join(ROOT, 'app', '(app)', 'admin')

function pageFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...pageFiles(full))
    else if (entry === 'page.tsx') found.push(full)
  }
  return found.sort()
}

const relative = (file: string): string => path.relative(ROOT, file).replaceAll('\\', '/')
const files = pageFiles(ADMIN)

describe('every admin page checks the caller itself', () => {
  it('finds the admin pages (a rename must not make this test vacuous)', () => {
    expect(files.map(relative)).toEqual([
      'app/(app)/admin/alerts/page.tsx',
      'app/(app)/admin/audit/page.tsx',
      'app/(app)/admin/lists/page.tsx',
      'app/(app)/admin/other/page.tsx',
      'app/(app)/admin/page.tsx',
      'app/(app)/admin/users/page.tsx',
    ])
  })

  it.each(files.map((file) => [relative(file), file] as const))('%s', (name, file) => {
    const source = readFileSync(file, 'utf8')
    const guarded = /\brequireAction\s*\(/.test(source) || /\brequireRole\s*\(/.test(source)
    expect(
      guarded,
      `${name} calls neither requireAction nor requireRole; the admin layout is skipped on an RSC request`,
    ).toBe(true)
    // `requireUser()` alone is not a permission: every signed-in role passes it.
    expect(source, `${name} must import the guard it calls`).toContain("from '@/src/lib/auth/session'")
  })

  it('the admin layout is defence in depth, not a raw role comparison', () => {
    const layout = readFileSync(path.join(ADMIN, 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/\brequireRole\s*\(/)
    expect(layout, 'a role compared by hand writes no audit row and answers 200').not.toMatch(
      /user\.role\s*!==/,
    )
  })

  it('the dashboard asks the permission matrix, not just for a session', () => {
    const page = readFileSync(path.join(ROOT, 'app', '(app)', 'dashboard', 'page.tsx'), 'utf8')
    expect(page).toContain("requireAction('dashboard.view')")
  })
})
