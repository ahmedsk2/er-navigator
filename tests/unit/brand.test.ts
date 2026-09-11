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
    const script = readFileSync(resolve(__dirname, '../../scripts/generate-icons.mjs'), 'utf8')
    expect(script).toContain('src/components/brand/mark-paths.json')
    expect(script).not.toMatch(/const (HEART|TRACE) =/)
  })

  it('grows its bars as it gets small, where a hairline would vanish', () => {
    expect(markGrow(44)).toBe(0.4)
    expect(markGrow(36)).toBe(0.7)
    expect(markGrow(28)).toBe(1)
  })
})
