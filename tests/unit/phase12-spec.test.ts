import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Phase 12 review round, made fail-first.
 *
 * Every finding of that round landed on `docs/specs/phase12-go-live-readiness.md` rather than on
 * shipped code, because the slice it describes is not built yet. A document cannot be proven by
 * running it, so this file does what `page-guards.test.ts` and `server-actions.test.ts` do for
 * source: it reads the artefact and asserts the one sentence each finding turned on. Deliberately
 * dumb, so the correction cannot be quietly reverted by the builder who implements the slice, and
 * so the arithmetic the spec relies on (contrast, the worker's heartbeat window) is checked
 * against the real token file and the real compose file rather than against prose.
 *
 * When a slice is built, its own unit, database and e2e tests take over; these assertions stay as
 * the record of what the review changed.
 */
const ROOT = path.resolve(__dirname, '../..')
const spec = readFileSync(path.join(ROOT, 'docs/specs/phase12-go-live-readiness.md'), 'utf8')

/**
 * The body of `## N. …` up to the next `## ` heading or the `---` that ends the slice. Not
 * `\n# `: the seed's `docker exec` block is a shell script whose comment lines start that way.
 */
function item(n: number): string {
  const match = spec.match(new RegExp(`\\n## ${n}\\. [^\\n]*\\n([\\s\\S]*?)(?=\\n## |\\n---\\n)`))
  expect(match, `item ${n} not found in the spec`).not.toBeNull()
  return match![1]!
}

const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const tokens = Object.fromEntries(
  [...theme.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
) as Record<string, string>

// The same luminance and contrast as tests/unit/tokens.test.ts, so one number cannot mean two
// things in two files.
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('item 1: the instance banner', () => {
  it('names a background token that holds white text at AA', () => {
    const banner = item(1)
    const pair = banner.match(/`bg-([a-z0-9-]+)` with `text-white`/)
    expect(pair, 'the banner colour bullet no longer names a `bg-…` / `text-white` pair').not.toBeNull()
    const token = `color-${pair![1]!}`
    expect(tokens[token], `${token} is not a token in app/globals.css`).toBeDefined()
    // 4.5:1, the AA minimum for normal text. `--color-band-h4` (#b8790f) is 3.63:1 on white and
    // src/components/__tests__/bands.test.ts already asserts that it fails; the ink variant is
    // the pair the rest of the app uses (BAND_PILL.h4).
    expect(contrast('#ffffff', tokens[token]!)).toBeGreaterThanOrEqual(4.5)
  })

  it('carries print-color-adjust on the element it says prints', () => {
    const banner = item(1)
    // The banner is coloured text on a coloured ground and the spec requires it to print. The CSS
    // default is `print-color-adjust: economy`, so the background is dropped and the light text
    // is kept: white on white paper. app/globals.css has no global rule (its @media print block
    // sets `html, body { background: #fff }`), and every surface in this app that must keep a
    // colour on paper opts in per element — AdaaBullets, ArrivalTable, BarList, StaySplit.
    expect(banner).toMatch(/print-color-adjust:exact/)
    // And the sample markup, not only the prose, so the builder copies it.
    const markup = banner.match(/<div data-instance-banner[^\n]*/)
    expect(markup, 'the banner markup sample is gone').not.toBeNull()
    expect(markup![0]).toContain('print-color-adjust:exact')
  })
})

describe('item 3: the demo seed', () => {
  it('runs its happy-path database test somewhere the whole-table refusals can pass', () => {
    const seed = item(3)
    // Refusals 4 and 5 are whole-table counts — any Case opened by a non-demo user, any MRN
    // outside the 999999 prefix — and that is the safety property, so it must not be scoped away.
    // The consequence is that the happy-path tests cannot run on the lead's shared database: it
    // permanently holds the Playwright fixture cases (60 today, opened by e2e_*), and the sibling
    // tests/db files create more in parallel. So the file gets its own Postgres schema and the
    // seed takes an injected client.
    expect(seed).toContain('demo_seed_test')
    expect(seed).toMatch(/migrate deploy/)
    expect(seed, 'runDemoSeed must accept the client its test points at').toMatch(/prisma\??: PrismaClient/)
  })
})

/**
 * The changelog is the handoff between phases (CLAUDE.md), and an audit action named there that
 * does not exist sends the next reader looking for a row that can never be written. The Phase 12
 * line for [ERN-P12.30] said `export.download`; the action the code writes, the permission in the
 * matrix and the filter on /admin/audit are all `export.xlsx`.
 */
describe('the changelog names real audit actions', () => {
  const changelog = readFileSync(path.join(ROOT, 'docs/CHANGELOG.md'), 'utf8')
  const audit = readFileSync(path.join(ROOT, 'src/lib/audit.ts'), 'utf8')
  const actions = new Set([...audit.matchAll(/^\s*\|\s*'([a-z][a-z.]+)'$/gm)].map((m) => m[1]!))

  it('reads its own action list, so this test is not a second copy of it', () => {
    expect(actions.size).toBeGreaterThan(20)
    expect(actions.has('export.xlsx')).toBe(true)
    expect(actions.has('report.print')).toBe(true)
  })

  it('claims no action the audit module does not define', () => {
    // Only the prefixes the module actually uses, so `pnpm.overrides` and `worker.js` are not
    // mistaken for action names.
    const prefixes = [...new Set([...actions].map((a) => a.split('.')[0]!))].join('|')
    const claimed = [...changelog.matchAll(new RegExp(`\`((?:${prefixes})\\.[a-z.]+)\``, 'g'))]
      .map((m) => m[1]!)
      // `export.spec.ts` is a file, not an action.
      .filter((a) => !/\.(ts|tsx|js|mjs|cjs|json|md|sh|yml|css|png)$/.test(a))
    expect(claimed.length, 'the changelog names no audit action at all').toBeGreaterThan(0)
    expect([...new Set(claimed)].filter((a) => !actions.has(a))).toEqual([])
  })
})

/**
 * The two Phase 12 guides are read by people standing in front of the app: a presenter with
 * fifteen staff watching, and a navigator at the desk. A control named in bold that the screen
 * does not have is worse than no sentence at all, so each claim is checked against the component
 * that renders it rather than against prose.
 */
describe('the guides name the controls the app actually renders', () => {
  it('calls the case summary button by its own name', () => {
    const script = readFileSync(path.join(ROOT, 'docs/guide/demo-script.md'), 'utf8')
    const sheet = readFileSync(path.join(ROOT, 'src/components/cases/CaseSummarySheet.tsx'), 'utf8')
    // `<Button tone="main" onClick={onCopy}>Copy</Button>`, and tests/e2e/cases.spec.ts:786 clicks
    // it by that exact name. The feature is still "copy the summary as text"; the control is not.
    expect(sheet).toMatch(/onClick=\{onCopy\}>\s*Copy\s*</)
    expect([...script.matchAll(/\*\*(Copy[^*]*)\*\*/g)].map((m) => m[1]!)).toEqual(['Copy'])
  })

  it('puts "+ New case" where the rail actually puts it', () => {
    const rail = readFileSync(path.join(ROOT, 'src/components/shell/TabBar.tsx'), 'utf8')
    const guide = readFileSync(path.join(ROOT, 'docs/guide/nurse-quick-guide.md'), 'utf8')
    // The rail's order is the wordmark, the tab list, "+ New case", then the signed-in block
    // whose last line links to /account. So on a laptop the button is at the foot, above that
    // block — not at the top, where the guide sent a nurse looking.
    const newCase = rail.indexOf('href="/cases/new"')
    expect(newCase).toBeGreaterThan(rail.indexOf('{tabs.map('))
    expect(newCase).toBeLessThan(rail.indexOf('href="/account"'))
    expect(guide, 'the guide puts + New case at the top of the rail').not.toMatch(/top of the left-hand rail/)
    expect(guide).toMatch(/foot of the left-hand rail/)
  })
})

describe('item 6: the alert email retry pass', () => {
  const compose = readFileSync(path.join(ROOT, 'docker-compose.production.yml'), 'utf8')
  const worker = readFileSync(path.join(ROOT, 'worker/alerts.ts'), 'utf8')

  it('is bounded well inside the worker tick and the heartbeat window', () => {
    const retry = item(6)
    // sendWithOneRetry always `await sleep(30_000)` between its two attempts. The retry pass
    // replays a backlog through it at the top of every cycle, before the heartbeat is touched
    // and while the worker's overlap guard drops every intervening tick — so at the specified cap
    // of 50 pending alerts a single cycle could sleep for 1500 s against a 900 s healthcheck.
    expect(retry, 'the retry pass must not pay the 30 s in-pass sleep').toMatch(/retryDelayMs: 0/)

    const budget = retry.match(/RETRY_PASS_BUDGET_MS = ([\d_]+)/)
    expect(budget, 'the retry pass needs a wall-clock budget, not only a count cap').not.toBeNull()
    const budgetSeconds = Number(budget![1]!.replaceAll('_', '')) / 1000

    const window = compose.match(/stat -c %Y \/tmp\/heartbeat\)[^"]*-lt (\d+)/)
    expect(window, 'the worker healthcheck no longer reads the heartbeat age').not.toBeNull()
    const tickMinutes = Number(worker.match(/DEFAULT_INTERVAL_MINUTES = (\d+)/)![1]!)

    expect(budgetSeconds).toBeLessThan(Number(window![1]!))
    expect(budgetSeconds).toBeLessThan(tickMinutes * 60)
  })
})

describe('item 5: must change the first password', () => {
  it('fails an API caller closed instead of exempting it', () => {
    const rule = item(5)
    // The first draft skipped the check for every `{ as: 'api' }` caller, on the stated ground
    // that they are "reads behind a page that has already redirected". Three of the four are
    // fetches; /api/export.xlsx is a plain <a href> (ExportPanel.tsx:177) — a bookmarkable
    // top-level navigation that returns the whole MRN workbook, and parseExportRange defaults
    // every missing parameter, so even a bare URL yields one. proxy.ts passes anything carrying
    // the session cookie, so nothing upstream catches it either.
    expect(rule).toContain('/api/export.xlsx')
    expect(rule, 'an api caller must be refused, not skipped').toContain('UnauthorizedError')
  })

  /**
   * The Phase 12 review round. Item 5 specified the redirect rule around an `x-pathname` header
   * that `proxy.ts` would set; Slice 12A found the header loops inside a server action's own
   * destination render and shipped `requireUser({ allowMustChange })` instead, so
   * `route-gate.test.ts:164` now asserts the header's *absence*. A spec that still mandates a
   * mechanism the code replaced is a trap for the next reader of it, so the deviation is recorded
   * in place, the way `docs/specs/phase6-admin-alerts.md:9` records the settings row that became
   * an environment variable.
   */
  it('records that x-pathname was never shipped, and names what replaced it', () => {
    const rule = item(5)
    const proxy = readFileSync(path.join(ROOT, 'proxy.ts'), 'utf8')
    expect(proxy, 'the gate sets x-pathname after all; this deviation would be stale').not.toContain('x-pathname')
    expect(rule, 'item 5 specifies x-pathname with no deviation recorded beside it').toContain('Recorded deviation')
    expect(rule).toContain('allowMustChange')
  })

  it('accounts for the two suites that mint an account through the Admin UI', () => {
    const rule = item(5)
    // "The existing suite must stay green unchanged, because every fixture account has the column
    // defaulted to false" is true of the seeded fixtures and false of the two files that create
    // an account at run time through Admin -> Users and then sign in as it:
    // tests/e2e/admin.spec.ts:92 asserts toHaveURL('/') after that sign-in, and
    // tests/demo/demo.spec.ts:79-86 does the same in its signIn helper for all four staff.
    expect(rule).toContain('tests/e2e/admin.spec.ts')
    expect(rule).toContain('tests/demo/demo.spec.ts')
  })
})
