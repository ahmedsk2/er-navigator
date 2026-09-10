import { describe, expect, it } from 'vitest'
import { appendDictated, dictationErrorLine } from '../ui/DictationButton'

/**
 * The pure halves of the microphone (Phase 10): how dictated words join the box, and what the
 * recogniser's error code tells the nurse. The button itself has no unit test — there is no DOM
 * harness — and is driven through a stand-in recogniser in tests/e2e/cases.spec.ts.
 */
describe('appendDictated', () => {
  it('appends with one space between, whatever spacing either side brought', () => {
    expect(appendDictated('Chest pain', 'for admission')).toBe('Chest pain for admission')
    expect(appendDictated('Chest pain  ', ' for admission ')).toBe('Chest pain for admission')
    expect(appendDictated('', ' for admission')).toBe('for admission')
  })

  it('leaves the box alone when nothing was heard', () => {
    expect(appendDictated('Chest pain', '   ')).toBe('Chest pain')
  })

  it("never fills past the box's cap", () => {
    expect(appendDictated('x'.repeat(76), 'for admission', 80)).toBe(`${'x'.repeat(76)} for`)
    expect(appendDictated('Chest pain', 'for admission', 80)).toBe('Chest pain for admission')
  })
})

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
