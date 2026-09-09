import { describe, expect, it } from 'vitest'
import { NEW_PASSWORD_MIN } from '@/src/lib/auth/password'
import { USERNAME_RE } from '../user-view'
import { generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from '../users'

describe('generateTemporaryPassword', () => {
  it('is long enough to pass the change-password rule', () => {
    expect(TEMPORARY_PASSWORD_LENGTH).toBeGreaterThanOrEqual(NEW_PASSWORD_MIN)
    expect(generateTemporaryPassword()).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
  })

  it('avoids the characters that are misread when a password is read out loud', () => {
    const sample = Array.from({ length: 200 }, () => generateTemporaryPassword()).join('')
    expect(sample).not.toMatch(/[iloILO01]/)
  })

  it('is different every time', () => {
    const many = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()))
    expect(many.size).toBe(50)
  })
})

describe('USERNAME_RE', () => {
  it('accepts the shapes a ward actually uses', () => {
    for (const name of ['sami', 'a.hassan', 'nurse_07', 'er-navigator']) {
      expect(USERNAME_RE.test(name), name).toBe(true)
    }
  })

  it('refuses spaces, capitals, punctuation and anything too short', () => {
    for (const name of ['ab', 'Sami', 'two words', 'has@sign', '.leading', 'x'.repeat(33)]) {
      expect(USERNAME_RE.test(name), name).toBe(false)
    }
  })
})
