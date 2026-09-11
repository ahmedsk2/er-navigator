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
})
