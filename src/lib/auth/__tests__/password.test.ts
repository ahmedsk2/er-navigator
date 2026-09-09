import { describe, expect, it, vi } from 'vitest'
import {
  BCRYPT_COST,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  loginPasswordSchema,
  loginUsernameSchema,
  NEW_PASSWORD_MIN,
  newPasswordSchema,
  verifyPassword,
} from '@/src/lib/auth/password'

describe('password hashing', () => {
  it('hashes at the same cost the seed uses, and never returns the plaintext', async () => {
    const hash = await hashPassword('a-correct-passphrase')
    expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$`))
    expect(hash).not.toContain('a-correct-passphrase')
  })

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('a-correct-passphrase')
    expect(await verifyPassword('a-correct-passphrase', hash)).toBe(true)
    expect(await verifyPassword('a-wrong-passphrase', hash)).toBe(false)
  })

  it('is salted: the same password hashes to two different strings', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-twice'), hashPassword('same-password-twice')])
    expect(a).not.toBe(b)
  })
})

describe('timing parity for unknown users', () => {
  it('still runs bcrypt, against the dummy hash, when there is no user', async () => {
    const compare = vi.fn(async () => false)
    const result = await verifyPassword('whatever-was-typed', null, compare)
    expect(result).toBe(false)
    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith('whatever-was-typed', DUMMY_PASSWORD_HASH)
  })

  it('never reports success for a missing hash, even if the comparator says true', async () => {
    const compare = vi.fn(async () => true)
    expect(await verifyPassword('whatever-was-typed', null, compare)).toBe(false)
    expect(compare).toHaveBeenCalledTimes(1)
  })

  it('compares against the real hash when the user exists', async () => {
    const compare = vi.fn(async () => true)
    expect(await verifyPassword('typed', '$2b$12$real-looking-hash', compare)).toBe(true)
    expect(compare).toHaveBeenCalledWith('typed', '$2b$12$real-looking-hash')
  })

  it('ships a dummy hash that is a real cost-12 bcrypt hash', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$[./A-Za-z0-9]{53}$`))
  })
})

describe('input schemas', () => {
  it('trims the username and bounds it at 64', () => {
    expect(loginUsernameSchema.parse('  admin  ')).toBe('admin')
    expect(loginUsernameSchema.safeParse('').success).toBe(false)
    expect(loginUsernameSchema.safeParse('   ').success).toBe(false)
    expect(loginUsernameSchema.safeParse('x'.repeat(64)).success).toBe(true)
    expect(loginUsernameSchema.safeParse('x'.repeat(65)).success).toBe(false)
  })

  it('accepts any non-empty login password up to 256 characters', () => {
    expect(loginPasswordSchema.safeParse('x').success).toBe(true)
    expect(loginPasswordSchema.safeParse('').success).toBe(false)
    expect(loginPasswordSchema.safeParse('x'.repeat(256)).success).toBe(true)
    expect(loginPasswordSchema.safeParse('x'.repeat(257)).success).toBe(false)
  })

  it('requires a new password of at least 12 characters', () => {
    expect(NEW_PASSWORD_MIN).toBe(12)
    expect(newPasswordSchema.safeParse('x'.repeat(11)).success).toBe(false)
    expect(newPasswordSchema.safeParse('x'.repeat(12)).success).toBe(true)
    expect(newPasswordSchema.safeParse('x'.repeat(257)).success).toBe(false)
  })
})
