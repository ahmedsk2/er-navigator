import { describe, expect, it } from 'vitest'
import { NEW_PASSWORD_MIN } from '@/src/lib/auth/password'
import { EMAIL_MAX, USERNAME_RE } from '../user-view'
import { emailSchema, generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from '../users'

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

/**
 * The staff work address (Phase 7). It is the alerts worker's whole directory, so "blank" has to
 * mean NULL rather than an empty string — the column is unique and two blanks would collide.
 */
describe('emailSchema', () => {
  const parse = (input: unknown) => emailSchema.safeParse(input)

  it('turns nothing at all into null', () => {
    for (const blank of ['', '   ', null, undefined]) {
      const result = parse(blank)
      expect(result.success, JSON.stringify(blank)).toBe(true)
      if (result.success) expect(result.data).toBeNull()
    }
  })

  it('trims and lower-cases, so one mailbox cannot be two rows', () => {
    const result = parse('  Sami.Ali@Hospital.Example  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('sami.ali@hospital.example')
  })

  it('refuses something that is not an address', () => {
    for (const bad of ['sami', 'sami@', '@example.org', 'two words@x.org']) {
      expect(parse(bad).success, bad).toBe(false)
    }
  })

  it('refuses an address longer than RFC 5321 allows', () => {
    expect(EMAIL_MAX).toBe(254)
    const long = `${'a'.repeat(EMAIL_MAX)}@example.org`
    expect(parse(long).success).toBe(false)
    expect(parse(`${'a'.repeat(EMAIL_MAX - 'x@example.org'.length)}x@example.org`).success).toBe(true)
  })
})
