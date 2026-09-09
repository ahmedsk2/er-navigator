import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHART, CHART_TOKEN_NAMES } from '../theme'

/**
 * Recharts needs literal colours, so `charts/theme.ts` duplicates part of the `@theme` block in
 * `app/globals.css`. This is what keeps the duplicate honest: change a token in one place and the
 * suite fails instead of the charts quietly drifting off the design system.
 */
const css = readFileSync(path.resolve(__dirname, '../../../../../app/globals.css'), 'utf8')
const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const tokens = Object.fromEntries(
  [...theme.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
) as Record<string, string>

describe('chart colours', () => {
  it.each(Object.entries(CHART_TOKEN_NAMES))('%s is --%s from app/globals.css', (key, token) => {
    expect(tokens[token], `--${token} is not in the @theme block`).toBeDefined()
    expect(CHART[key as keyof typeof CHART]).toBe(tokens[token])
  })

  it('names a token for every colour the charts use', () => {
    expect(Object.keys(CHART).sort()).toEqual(Object.keys(CHART_TOKEN_NAMES).sort())
  })
})
