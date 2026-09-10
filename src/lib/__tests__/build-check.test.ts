import { describe, expect, it } from 'vitest'
import { isStaleBuild } from '../build-check'

describe('isStaleBuild', () => {
  it('is stale only when both fingerprints are known and differ', () => {
    expect(isStaleBuild('215e54fb28f073b3', 'cabe890610587dfd')).toBe(true)
    expect(isStaleBuild('cabe890610587dfd', 'cabe890610587dfd')).toBe(false)
  })

  it('never reloads on missing evidence', () => {
    expect(isStaleBuild(undefined, 'cabe890610587dfd')).toBe(false)
    expect(isStaleBuild(null, 'cabe890610587dfd')).toBe(false)
    expect(isStaleBuild('', 'cabe890610587dfd')).toBe(false)
    expect(isStaleBuild('cabe890610587dfd', null)).toBe(false)
    expect(isStaleBuild('cabe890610587dfd', '')).toBe(false)
    expect(isStaleBuild('  ', '  ')).toBe(false)
  })
})
