import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 9 rule: every colour in the app is a token in the one `@theme` block of
 * `app/globals.css`. The sign-in screen is where that rule is under most pressure, because its
 * illustration needs four band tints lightened for the teal ground — tints that are not tokens,
 * because nothing else in the app may use them. This is the grep that keeps that exception to
 * exactly four values in exactly one file, in the spirit of `tests/unit/server-actions.test.ts`.
 *
 * `app/global-error.tsx` is the other exception and gets the opposite test: it replaces the whole
 * document and cannot rely on the stylesheet, so it mirrors the tokens by hand — and a hand copy
 * drifts. Every hex in it must still be a value the `@theme` block defines.
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8')

/** #abc and #aabbcc alike, normalised to the six-digit lower-case form the tokens use. */
function hexesIn(source: string): string[] {
  const found = [...source.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)].map((m) => {
    const body = m[1]!.toLowerCase()
    return body.length === 3 ? `#${[...body].map((c) => c + c).join('')}` : `#${body}`
  })
  return [...new Set(found)].sort()
}

const theme = read('app/globals.css').match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const tokenValues = new Set(
  [...theme.matchAll(/--[a-z0-9-]+:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => m[1]!.toLowerCase()),
)

/** The band tints of the sign-in illustration, lightened so they read on the teal hero. */
const BAND_BAR_FILLS = ['#4fa87c', '#b56aa6', '#e0645a', '#e0a23a']

describe('colour literals outside the token block', () => {
  it('parses the @theme block (a rename must not make this test vacuous)', () => {
    expect(tokenValues.size).toBeGreaterThan(15)
    expect(tokenValues.has('#1f7a8c')).toBe(true)
  })

  it('allows exactly the four band-bar fills, and only on the sign-in page', () => {
    expect(hexesIn(read('app/login/page.tsx'))).toEqual(BAND_BAR_FILLS)
  })

  it.each([
    'app/login/login-form.tsx',
    'app/error.tsx',
    'app/not-found.tsx',
    'app/forbidden.tsx',
    'app/(app)/forbidden.tsx',
    'app/(app)/account/page.tsx',
    'src/components/holding.tsx',
  ])('%s carries no colour literal at all', (file) => {
    expect(hexesIn(read(file))).toEqual([])
  })

  it('keeps app/global-error.tsx a faithful hand copy of the tokens', () => {
    const hexes = hexesIn(read('app/global-error.tsx'))
    expect(hexes.length).toBeGreaterThan(3)
    for (const hex of hexes) expect(tokenValues, hex).toContain(hex)
  })
})
