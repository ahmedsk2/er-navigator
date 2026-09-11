import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOGIN_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  loginRateLimitFrom,
  LOGIN_RATE_WINDOW_MS,
  loginRateLimiter,
  SlidingWindowLimiter,
} from '@/src/lib/auth/rate-limit'

/** A clock the test moves by hand, so the window is tested without waiting for it. */
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('sliding window rate limiter', () => {
  it('allows exactly `limit` attempts inside the window and blocks the next one', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(5, 60_000, clock.now)
    for (let i = 0; i < 5; i += 1) {
      const r = limiter.check('10.0.0.1')
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(4 - i)
    }
    const blocked = limiter.check('10.0.0.1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('slides: the oldest attempt falls out of the window and one more is allowed', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(3, 60_000, clock.now)
    limiter.check('ip')
    clock.advance(20_000)
    limiter.check('ip')
    clock.advance(20_000)
    limiter.check('ip')
    expect(limiter.check('ip').allowed).toBe(false)

    // 61 s after the first attempt, that attempt has expired; the next two have not.
    clock.advance(21_000)
    expect(limiter.check('ip').allowed).toBe(true)
    expect(limiter.check('ip').allowed).toBe(false)
  })

  it('reports how long to wait, measured from the oldest attempt in the window', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(2, 60_000, clock.now)
    limiter.check('ip')
    clock.advance(10_000)
    limiter.check('ip')
    const blocked = limiter.check('ip')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(50_000)
  })

  it('counts each key separately, so one busy phone does not lock out the ward', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(2, 60_000, clock.now)
    limiter.check('a')
    limiter.check('a')
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })

  it('a blocked attempt does not extend the block', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(1, 60_000, clock.now)
    limiter.check('ip')
    clock.advance(30_000)
    expect(limiter.check('ip').allowed).toBe(false)
    clock.advance(31_000)
    expect(limiter.check('ip').allowed).toBe(true)
  })

  it('forgets keys whose attempts have all expired, so the map cannot grow without bound', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(5, 60_000, clock.now)
    for (let i = 0; i < 50; i += 1) limiter.check(`ip-${i}`)
    expect(limiter.size).toBe(50)
    clock.advance(61_000)
    limiter.check('someone-else')
    expect(limiter.size).toBe(1)
  })

  it('reset clears one key, or all of them', () => {
    const limiter = new SlidingWindowLimiter(1, 60_000)
    limiter.check('a')
    limiter.check('b')
    limiter.reset('a')
    expect(limiter.size).toBe(1)
    limiter.reset()
    expect(limiter.size).toBe(0)
  })

  it('ships the login limiter the plan asks for: 5 attempts per rolling 60 s', () => {
    expect(LOGIN_RATE_LIMIT).toBe(5)
    expect(LOGIN_RATE_WINDOW_MS).toBe(60_000)
    loginRateLimiter.reset()
    for (let i = 0; i < LOGIN_RATE_LIMIT; i += 1) expect(loginRateLimiter.check('probe').allowed).toBe(true)
    expect(loginRateLimiter.check('probe').allowed).toBe(false)
    loginRateLimiter.reset()
  })
})

/**
 * Phase 12 item 8 (readiness audit P3). Fifteen staff behind one hospital NAT address at a demo
 * are one client IP, and the sixth of them in a minute would be turned away. The limit becomes
 * configurable per instance; production leaves the variable unset and stays at five.
 */
describe('the configurable login limit', () => {
  const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars })

  it('is five when the variable is unset', () => {
    expect(DEFAULT_LOGIN_RATE_LIMIT).toBe(5)
    expect(loginRateLimitFrom(env())).toBe(5)
  })

  it('takes an integer', () => {
    expect(loginRateLimitFrom(env({ LOGIN_RATE_LIMIT_PER_MINUTE: '60' }))).toBe(60)
    expect(loginRateLimitFrom(env({ LOGIN_RATE_LIMIT_PER_MINUTE: '1' }))).toBe(1)
    expect(loginRateLimitFrom(env({ LOGIN_RATE_LIMIT_PER_MINUTE: '1000' }))).toBe(1000)
  })

  it('falls back to the default rather than throwing on anything else', () => {
    // The login page must not fail to render because someone typed "five" into Coolify.
    for (const value of ['', '   ', 'five', '0', '-3', '1.5', '99999', 'NaN', '6e1']) {
      expect(loginRateLimitFrom(env({ LOGIN_RATE_LIMIT_PER_MINUTE: value })), value).toBe(5)
    }
  })

  it('a limiter built at the raised number admits that many in one window', () => {
    const clock = fakeClock()
    const limiter = new SlidingWindowLimiter(loginRateLimitFrom(env({ LOGIN_RATE_LIMIT_PER_MINUTE: '60' })), LOGIN_RATE_WINDOW_MS, clock.now)
    for (let i = 0; i < 60; i += 1) expect(limiter.check('10.0.0.9').allowed).toBe(true)
    expect(limiter.check('10.0.0.9').allowed).toBe(false)
    clock.advance(LOGIN_RATE_WINDOW_MS + 1)
    expect(limiter.check('10.0.0.9').allowed).toBe(true)
  })
})
