/**
 * Phase 16 (docs/specs/phase16-forgot-password.md, section 6): the token itself.
 *
 * Everything in this file is pure, so the rules that matter most — 32 random bytes, only the
 * digest is ever stored, a used or expired row is refused, and the compare is constant time —
 * are asserted without a database and without a browser. The database half is
 * tests/db/forgot-password.test.ts.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  resetTokenUsable,
  RESET_REQUESTS_PER_HOUR,
  RESET_REQUEST_WINDOW_MS,
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MINUTES,
  RESET_TOKEN_TTL_MS,
} from '../reset-token'

const NOW = new Date('2026-09-13T10:00:00.000Z')

describe('generateResetToken', () => {
  it('is 32 random bytes, base64url, so it survives a URL untouched', () => {
    expect(RESET_TOKEN_BYTES).toBe(32)
    const token = generateResetToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // base64url of 32 bytes, unpadded.
    expect(token).toHaveLength(43)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('is different every time', () => {
    const many = new Set(Array.from({ length: 200 }, () => generateResetToken()))
    expect(many.size).toBe(200)
  })
})

describe('hashResetToken', () => {
  it('is sha256 of the raw token in hex, and never the token itself', () => {
    const token = generateResetToken()
    const hash = hashResetToken(token)
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(token)
    expect(token).not.toContain(hash)
  })

  it('is stable, so a link presented twice finds the same row', () => {
    const token = generateResetToken()
    expect(hashResetToken(token)).toBe(hashResetToken(token))
  })

  it('separates two tokens that differ by one character', () => {
    expect(hashResetToken('aaaa')).not.toBe(hashResetToken('aaab'))
  })
})

describe('resetTokenExpiry', () => {
  it('is thirty minutes after now', () => {
    expect(RESET_TOKEN_TTL_MINUTES).toBe(30)
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60_000)
    expect(resetTokenExpiry(NOW).toISOString()).toBe('2026-09-13T10:30:00.000Z')
  })

  it('does not mutate the clock it was handed', () => {
    const now = new Date(NOW)
    resetTokenExpiry(now)
    expect(now.getTime()).toBe(NOW.getTime())
  })
})

describe('resetTokenUsable', () => {
  const token = generateResetToken()
  const hash = hashResetToken(token)
  const good = { tokenHash: hash, expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null }

  it('accepts an unused, unexpired row whose digest matches', () => {
    expect(resetTokenUsable(good, hash, NOW)).toBe(true)
  })

  it('refuses a row that is not there at all', () => {
    expect(resetTokenUsable(null, hash, NOW)).toBe(false)
  })

  it('refuses a row that has been used', () => {
    expect(resetTokenUsable({ ...good, usedAt: new Date(NOW.getTime() - 1000) }, hash, NOW)).toBe(false)
  })

  it('refuses a row that has expired, and one that expires exactly now', () => {
    expect(resetTokenUsable({ ...good, expiresAt: new Date(NOW.getTime() - 1) }, hash, NOW)).toBe(false)
    expect(resetTokenUsable({ ...good, expiresAt: new Date(NOW.getTime()) }, hash, NOW)).toBe(false)
  })

  it('refuses a digest that does not match the row it was handed', () => {
    expect(resetTokenUsable(good, hashResetToken(generateResetToken()), NOW)).toBe(false)
  })

  /**
   * The lookup is by an indexed hash of 32 random bytes, so this compare is belt and braces. It is
   * here because a token check that is not constant time is the kind of thing that gets copied,
   * and the only way to keep it is to assert it. A digest of the wrong LENGTH must not throw
   * either: `timingSafeEqual` refuses buffers of different sizes.
   */
  it('compares in constant time and survives a digest of the wrong length', () => {
    const source = readSource()
    expect(source).toContain('timingSafeEqual')
    expect(source, 'a === on the digests is not a constant-time compare').not.toMatch(
      /tokenHash\s*===\s*presentedHash/,
    )
    expect(resetTokenUsable(good, 'deadbeef', NOW)).toBe(false)
    expect(resetTokenUsable(good, '', NOW)).toBe(false)
  })
})

describe('the per-user request rule', () => {
  it('is three an hour', () => {
    expect(RESET_REQUESTS_PER_HOUR).toBe(3)
    expect(RESET_REQUEST_WINDOW_MS).toBe(60 * 60_000)
  })
})

const readSource = (): string => readFileSync(path.resolve(__dirname, '../reset-token.ts'), 'utf8')
