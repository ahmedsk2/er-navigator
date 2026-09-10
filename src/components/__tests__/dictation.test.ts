import { describe, expect, it } from 'vitest'
import { dictationErrorLine } from '../ui/DictationButton'

/**
 * The pure half of the microphone (Phase 10): what the recogniser's error code tells the nurse.
 * The button itself has no unit test — there is no DOM harness — and is driven through a
 * stand-in recogniser in tests/e2e/cases.spec.ts.
 */
describe('dictationErrorLine', () => {
  it('says the browser has blocked the microphone, for either refusal', () => {
    const blocked =
      'The browser has blocked the microphone for this site. Allow it in the site settings, or type instead.'
    expect(dictationErrorLine('not-allowed')).toBe(blocked)
    expect(dictationErrorLine('service-not-allowed')).toBe(blocked)
  })

  it('names a missing microphone, a lost network and a silence', () => {
    expect(dictationErrorLine('audio-capture')).toBe('No microphone was found on this device.')
    expect(dictationErrorLine('network')).toBe('Dictation needs a network connection.')
    expect(dictationErrorLine('no-speech')).toBe('Nothing was heard. Tap the microphone and speak again.')
  })

  it('says nothing for an abort, or for a code it does not know', () => {
    // "aborted" is the page stopping its own session (leaving it, a second tap): nothing to fix.
    expect(dictationErrorLine('aborted')).toBeNull()
    expect(dictationErrorLine('language-not-supported')).toBeNull()
    expect(dictationErrorLine('')).toBeNull()
    expect(dictationErrorLine(undefined)).toBeNull()
    // A lookup table would answer these from Object.prototype; the codes are matched, not looked up.
    expect(dictationErrorLine('constructor')).toBeNull()
    expect(dictationErrorLine('toString')).toBeNull()
  })
})
