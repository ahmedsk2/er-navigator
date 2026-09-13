/**
 * The shared reset (P15.63), against a fake store — the `AlertStore` pattern from
 * src/lib/alerts/__tests__/cycle.test.ts. The rule asserted here is the one Admin → Users and
 * `scripts/reset-password.ts` both run: a fresh password every time, hashed before it is stored,
 * the lock and the failure count cleared, `mustChangePassword` back on, every session gone, and
 * one `user.password` payload that names who did it and never the password.
 *
 * The Prisma half — that those fields really are the columns written, in one transaction, with an
 * audit row beside them — is asserted against a real Postgres in tests/db/reset-password.test.ts.
 */
import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { NEW_PASSWORD_MIN } from '../password'
import {
  generateTemporaryPassword,
  resetAuditAfter,
  resetPassword,
  TEMPORARY_PASSWORD_LENGTH,
  type ApplyResetInput,
  type PasswordResetStore,
} from '../password-reset'

class FakeStore implements PasswordResetStore {
  applied: ApplyResetInput[] = []
  signedOut: string[] = []
  sessions = 3

  async apply(input: ApplyResetInput): Promise<void> {
    this.applied.push(input)
  }

  async deleteSessions(userId: string): Promise<number> {
    this.signedOut.push(userId)
    return this.sessions
  }
}

const TARGET = { id: 'user-1', username: 'sami' }

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

describe('resetPassword', () => {
  it('hashes the password it returns, and never hands the store the plain text', async () => {
    const store = new FakeStore()
    const result = await resetPassword(store, TARGET, { by: 'host' })

    expect(result.temporaryPassword).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
    expect(store.applied).toHaveLength(1)
    const applied = store.applied[0]!
    expect(applied.passwordHash).not.toBe(result.temporaryPassword)
    expect(applied.passwordHash.startsWith('$2')).toBe(true)
    expect(await bcrypt.compare(result.temporaryPassword, applied.passwordHash)).toBe(true)
    expect(JSON.stringify(applied.origin)).not.toContain(result.temporaryPassword)
  })

  it('hashes at the cost the seed and the login path use', async () => {
    const store = new FakeStore()
    await resetPassword(store, TARGET, { by: 'host' })
    // `$2b$12$…`: the cost is the third field, and it has to match BCRYPT_COST or a seeded
    // account and a reset one would verify differently.
    expect(store.applied[0]!.passwordHash.split('$')[2]).toBe('12')
  })

  it('signs the user out everywhere and reports how many sessions went', async () => {
    const store = new FakeStore()
    store.sessions = 2
    const result = await resetPassword(store, TARGET, { by: 'admin', adminUsername: 'admin' })
    expect(store.signedOut).toEqual([TARGET.id])
    expect(result.sessionsDeleted).toBe(2)
  })

  it('gives a different password every time it is called', async () => {
    const store = new FakeStore()
    const a = await resetPassword(store, TARGET, { by: 'host' })
    const b = await resetPassword(store, TARGET, { by: 'host' })
    expect(a.temporaryPassword).not.toBe(b.temporaryPassword)
    expect(store.applied[0]!.passwordHash).not.toBe(store.applied[1]!.passwordHash)
  })

  it('passes the target through untouched, so the store writes the row that was asked for', async () => {
    const store = new FakeStore()
    await resetPassword(store, TARGET, { by: 'host' })
    expect(store.applied[0]!.userId).toBe(TARGET.id)
    expect(store.applied[0]!.username).toBe(TARGET.username)
  })
})

describe('resetAuditAfter', () => {
  it('names the administrator when the reset came from Admin → Users', () => {
    expect(resetAuditAfter('sami', { by: 'admin', adminUsername: 'ahmed' })).toEqual({
      username: 'sami',
      self: false,
      byAdmin: 'ahmed',
      mustChangePassword: true,
    })
  })

  it('says it came from the host when there was nobody signed in to do it', () => {
    expect(resetAuditAfter('sami', { by: 'host' })).toEqual({
      username: 'sami',
      self: false,
      fromHost: true,
      mustChangePassword: true,
    })
  })

  it('never carries a password field in either shape', () => {
    for (const after of [
      resetAuditAfter('sami', { by: 'admin', adminUsername: 'ahmed' }),
      resetAuditAfter('sami', { by: 'host' }),
    ]) {
      expect(Object.keys(after).some((k) => /password/i.test(k) && k !== 'mustChangePassword')).toBe(false)
    }
  })
})
