import { describe, expect, it } from 'vitest'
import { initialsOf } from '../shell/initials'

/**
 * The initials in the header's menu trigger and at the foot of the desktop rail (Phase 9). They
 * are decorative — the accessible name of the trigger is still "Menu" and the rail's user block
 * is not interactive — but they are on screen in every signed-in view, so the rule that makes
 * them has to survive the display names this hospital actually has: two words, one word, three
 * words, an initial with a full stop, and the Arabic names the ED writes in Arabic.
 */
describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Nadia Navigator')).toBe('NN')
    expect(initialsOf('Sami Supervisor')).toBe('SS')
  })

  it('takes three words two letters deep, not the last word', () => {
    expect(initialsOf('Amal Al Qahtani')).toBe('AA')
  })

  it('gives one letter for a one-word name', () => {
    expect(initialsOf('Administrator')).toBe('A')
  })

  it('ignores punctuation and extra spaces', () => {
    expect(initialsOf('  S.  Alqahtani ')).toBe('SA')
    expect(initialsOf('al-Hassan Ibrahim')).toBe('AI')
  })

  it('upper-cases what it finds, in the name`s own script', () => {
    expect(initialsOf('nadia navigator')).toBe('NN')
    expect(initialsOf('أحمد القحطاني')).toBe('أا')
  })

  it('falls back to nothing rather than throwing on an empty name', () => {
    expect(initialsOf('')).toBe('')
    expect(initialsOf('   ')).toBe('')
  })
})
