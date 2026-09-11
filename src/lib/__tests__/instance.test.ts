import { describe, expect, it } from 'vitest'
import { INSTANCE_LABEL_RE, instanceBannerText, instanceLabel } from '@/src/lib/instance'

/** `instanceLabel` takes `NodeJS.ProcessEnv`, whose `NODE_ENV` is required under this tsconfig. */
const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars })

/**
 * Phase 12 item 1 (D6). The label is what makes a demo copy tell you it is a demo copy, so an
 * unrecognisable value must read as "no label" and never as a label rendered raw into the page.
 */
describe('instanceLabel', () => {
  it('reads DEMO', () => {
    expect(instanceLabel(env({ INSTANCE_LABEL: 'DEMO' }))).toBe('DEMO')
  })

  it('is null when unset', () => {
    expect(instanceLabel(env())).toBeNull()
  })

  it('is null when blank', () => {
    expect(instanceLabel(env({ INSTANCE_LABEL: '  ' }))).toBeNull()
  })

  it('trims', () => {
    expect(instanceLabel(env({ INSTANCE_LABEL: '  DEMO ' }))).toBe('DEMO')
  })

  it('is null past 24 characters', () => {
    expect(instanceLabel(env({ INSTANCE_LABEL: 'D'.repeat(25) }))).toBeNull()
    expect(instanceLabel(env({ INSTANCE_LABEL: 'D'.repeat(24) }))).toBe('D'.repeat(24))
  })

  it('is null for anything outside the allowed alphabet', () => {
    expect(instanceLabel(env({ INSTANCE_LABEL: '<script>' }))).toBeNull()
    expect(instanceLabel(env({ INSTANCE_LABEL: 'UAT/2' }))).toBeNull()
  })

  it('accepts the whole allowed alphabet', () => {
    expect(INSTANCE_LABEL_RE.test('Demo 1 ._-')).toBe(true)
  })
})

describe('instanceBannerText', () => {
  it('is the exact wording the spec fixes', () => {
    expect(instanceBannerText('DEMO')).toBe('DEMO: invented patients only')
  })
})
