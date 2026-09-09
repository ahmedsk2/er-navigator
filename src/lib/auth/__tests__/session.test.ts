import { describe, expect, it } from 'vitest'
import {
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  needsSlidingRefresh,
  SESSION_TTL_MS,
  sessionCookieOptions,
  sessionExpiry,
  SLIDING_REFRESH_MS,
  TOKEN_BYTES,
} from '@/src/lib/auth/session'

describe('session tokens', () => {
  it('is 32 random bytes rendered as base64url', () => {
    expect(TOKEN_BYTES).toBe(32)
    const token = generateSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateSessionToken))
    expect(tokens.size).toBe(500)
  })

  it('hashes to 64 hex characters, deterministically', () => {
    const token = generateSessionToken()
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })

  it('is one-way: the hash is not the token and does not contain it', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
    expect(Buffer.from(hash, 'hex').toString('base64url')).not.toBe(token)
  })

  it('gives different tokens different hashes', () => {
    const hashes = new Set(Array.from({ length: 500 }, () => hashSessionToken(generateSessionToken())))
    expect(hashes.size).toBe(500)
  })

  it('is sha256 and nothing else', () => {
    expect(hashSessionToken('ern')).toBe('981bf06968595931d093e5c34a521c907c17cc192880d3451eb21e4cae406003')
  })
})

describe('expiry and sliding refresh', () => {
  const now = new Date('2026-09-09T10:00:00.000Z')

  it('expires twelve hours after it is issued', () => {
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000)
    expect(sessionExpiry(now)).toEqual(new Date('2026-09-09T22:00:00.000Z'))
  })

  it('treats the expiry instant itself as expired', () => {
    expect(isSessionExpired(new Date('2026-09-09T10:00:00.001Z'), now)).toBe(false)
    expect(isSessionExpired(now, now)).toBe(true)
    expect(isSessionExpired(new Date('2026-09-09T09:59:59.999Z'), now)).toBe(true)
  })

  it('refreshes at most once every five minutes, so a busy board is one UPDATE per five', () => {
    expect(SLIDING_REFRESH_MS).toBe(5 * 60 * 1000)
    expect(needsSlidingRefresh(new Date('2026-09-09T09:59:00.000Z'), now)).toBe(false)
    expect(needsSlidingRefresh(new Date('2026-09-09T09:55:00.000Z'), now)).toBe(true)
    expect(needsSlidingRefresh(new Date('2026-09-09T09:50:00.000Z'), now)).toBe(true)
    expect(needsSlidingRefresh(now, now)).toBe(false)
  })

  it('a refresh pushes the expiry a further twelve hours out', () => {
    const later = new Date('2026-09-09T21:00:00.000Z')
    expect(sessionExpiry(later)).toEqual(new Date('2026-09-10T09:00:00.000Z'))
  })
})

describe('cookie attributes', () => {
  it('is httpOnly, lax and site-wide in every environment', () => {
    for (const remember of [true, false]) {
      const o = sessionCookieOptions(remember)
      expect(o.httpOnly).toBe(true)
      expect(o.sameSite).toBe('lax')
      expect(o.path).toBe('/')
    }
  })

  it('is not marked secure outside production, so http://localhost works', () => {
    expect(process.env.NODE_ENV).not.toBe('production')
    expect(sessionCookieOptions(true).secure).toBe(false)
  })

  it('"remember this device" is the only thing that gives the cookie a lifetime', () => {
    expect(sessionCookieOptions(true).maxAge).toBe(SESSION_TTL_MS / 1000)
    expect(sessionCookieOptions(false).maxAge).toBeUndefined()
  })
})
