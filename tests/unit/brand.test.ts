import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import PATHS from '../../src/components/brand/mark-paths.json'
import { markStroke } from '../../src/components/brand/Mark'

/**
 * Phase 11: the mark is drawn from one file of paths, read by the header's `Mark` and by the
 * icon script, so the home-screen icon and the header cannot drift apart.
 */
describe('the mark', () => {
  it('keeps every point of its three strokes on the 48-unit badge', () => {
    for (const d of [PATHS.ecg, PATHS.arrow, PATHS.cross]) {
      const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      expect(numbers.length).toBeGreaterThan(0)
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

  it('thickens its stroke as it gets small, where a hairline would vanish', () => {
    expect(markStroke(44)).toBe(2.2)
    expect(markStroke(36)).toBe(2.4)
    expect(markStroke(28)).toBe(2.8)
    expect(markStroke(32)).toBeLessThanOrEqual(markStroke(28))
  })
})
