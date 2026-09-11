import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import PATHS from '../../src/components/brand/mark-paths.json'
import { markGrow } from '../../src/components/brand/Mark'

/**
 * Phase 11: the mark is the medical cross Ahmed chose, drawn from one file of outlines that the
 * header's `Mark` and the icon script both read, so the home-screen icon and the header cannot
 * drift apart.
 */
describe('the mark', () => {
  it('is three closed outlines, every point on the 48-unit grid', () => {
    expect(PATHS.cross).toHaveLength(3)
    for (const d of PATHS.cross) {
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
      const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      for (const n of numbers) {
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(PATHS.viewBox)
      }
    }
  })

  it('is the file the icon script draws from, not a copy of it', () => {
    const source = readFileSync(resolve(__dirname, '../../scripts/generate-icons.mjs'), 'utf8')
    // The code, not the docblock that names the file: a comment must not satisfy this.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/readFileSync\(\s*resolve\(\s*ROOT,\s*'src\/components\/brand\/mark-paths\.json'\s*\)/)
    expect(code).toMatch(/PATHS\.cross\.map\(/)
    // And no outline pasted in beside it, under any name.
    for (const d of PATHS.cross) expect(source).not.toContain(d.slice(0, 24))
    expect(code).not.toMatch(/['"`]M-?\d+(\.\d+)?[ ,]-?\d/)
  })

  it('is drawn on the global error page from the same outlines', () => {
    const page = readFileSync(resolve(__dirname, '../../app/global-error.tsx'), 'utf8')
    for (const d of PATHS.cross) expect(page).toContain(`d="${d}"`)
    expect(page).not.toContain('M12 21s-7-4.5-7-11')
  })

  it('grows its bars as it gets small, where a hairline would vanish, and never closes the gaps', () => {
    expect(markGrow(44)).toBe(0.4)
    expect(markGrow(36)).toBe(0.7)
    expect(markGrow(28)).toBe(1)
    // The bars and the gaps between them are the same width on the cross's own grid; a stroke of
    // that width, split either side of a bar, would leave the gaps a hairline.
    const bar = 1.984
    for (const size of [24, 28, 36, 44]) expect(markGrow(size)).toBeLessThan(bar)
  })
})
