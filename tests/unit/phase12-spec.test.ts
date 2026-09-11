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

/** The body of `## N. …` up to the next `## ` heading. */
function item(n: number): string {
  const match = spec.match(new RegExp(`\\n## ${n}\\. [^\\n]*\\n([\\s\\S]*?)(?=\\n## |\\n# )`))
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
