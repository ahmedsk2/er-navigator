import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contrast guard for the design tokens in app/globals.css (plan section 4). Survives the
 * template-extraction session: any token that is used as text must reach WCAG AA 4.5:1 on both
 * grounds, and every threshold band must reach the 3:1 non-text minimum.
 */
const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8')
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

const grounds = ['color-bg', 'color-panel'] as const
const textTokens = ['color-ink', 'color-muted', 'color-accent', 'color-band-h4-ink', 'color-band-ok', 'color-band-h6', 'color-band-h12', 'color-band-h24']
const bandTokens = ['color-band-ok', 'color-band-h4', 'color-band-h6', 'color-band-h12', 'color-band-h24']

describe('design tokens', () => {
  it('parses the @theme block', () => {
    expect(tokens['color-bg']).toBeDefined()
    expect(tokens['color-panel']).toBeDefined()
  })

  it.each(textTokens.flatMap((t) => grounds.map((g) => [t, g] as const)))('%s is at least 4.5:1 on %s (text)', (t, g) => {
    expect(tokens[t], `${t} missing`).toBeDefined()
    expect(contrast(tokens[t]!, tokens[g]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(bandTokens.flatMap((t) => grounds.map((g) => [t, g] as const)))('%s is at least 3:1 on %s (band)', (t, g) => {
    expect(contrast(tokens[t]!, tokens[g]!)).toBeGreaterThanOrEqual(3)
  })

  it('has a neutral no-data band distinct from ok', () => {
    expect(tokens['color-band-none']).toBeDefined()
    expect(tokens['color-band-none']).not.toBe(tokens['color-band-ok'])
  })
})
