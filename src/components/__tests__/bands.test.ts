import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BAND_BG, BAND_PILL, BAND_TEXT } from '../bands'
import type { Band } from '@/src/lib/domain/time'

/**
 * The band map is the one place the six bands meet the tokens (Phase 9). The classes are Tailwind
 * utilities named after the tokens in app/globals.css, so this test reads the same `@theme` block
 * tests/unit/tokens.test.ts reads and checks two things the eye cannot: that every class names a
 * token that exists, and that every pill background holds its text at 4.5:1.
 */
const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')
const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const tokens = Object.fromEntries(
  [...theme.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
) as Record<string, string>

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

const BANDS: Band[] = ['none', 'ok', 'h4', 'h6', 'h12', 'h24']

/** `bg-band-h4-ink` → the hex of `--color-band-h4-ink`; `text-white` → #ffffff. */
function hexOf(utility: string): string {
  const name = utility.replace(/^(bg|text)-/, '')
  if (name === 'white') return '#ffffff'
  const hex = tokens[`color-${name}`]
  if (!hex) throw new Error(`${utility} names no token in app/globals.css`)
  return hex
}

describe('band classes', () => {
  it.each(BANDS)('%s has a background, a text colour and a pill', (band) => {
    expect(BAND_BG[band]).toMatch(/^bg-/)
    expect(BAND_TEXT[band]).toMatch(/^text-/)
    expect(BAND_PILL[band].split(' ')).toHaveLength(2)
  })

  it.each(BANDS)('%s: every class names a real token', (band) => {
    hexOf(BAND_BG[band])
    hexOf(BAND_TEXT[band])
    for (const cls of BAND_PILL[band].split(' ')) hexOf(cls)
  })

  it.each(BANDS)('%s pill holds its text at 4.5:1', (band) => {
    const [bg, text] = BAND_PILL[band].split(' ') as [string, string]
    expect(bg).toMatch(/^bg-/)
    expect(text).toMatch(/^text-/)
    expect(contrast(hexOf(bg), hexOf(text))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the 4 h band off the text and pill surfaces, where it is too light', () => {
    expect(BAND_TEXT.h4).toBe('text-band-h4-ink')
    expect(BAND_PILL.h4.startsWith('bg-band-h4-ink')).toBe(true)
    expect(contrast(tokens['color-band-h4']!, '#ffffff')).toBeLessThan(4.5)
  })
})
