/**
 * Login rate limiting (locked plan section 5.1): 5 attempts per rolling 60 seconds per client IP.
 *
 * In-process, one Map, no dependencies. v1 runs a single app container behind Cloudflare, so
 * this is the whole story.
 *
 * LIMITATION, on purpose: a second replica would keep its own Map and the effective limit would
 * be 5 x replicas. Before scaling the app service past one container, move this to a shared
 * store (a Postgres table keyed by ip with a timestamp array, or Redis). The counter is also
 * lost on restart, which only ever makes the app more permissive for one window.
 *
 * The key is the client IP from `clientIpFrom()` (CF-Connecting-IP, trustworthy because the
 * origin is only reachable through Cloudflare). A request with no usable IP is limited under a
 * single shared key rather than let through.
 */
export type Clock = () => number

export type RateLimitResult = {
  allowed: boolean
  /** Attempts left in the current window after this one. */
  remaining: number
  /** How long until the oldest attempt leaves the window; 0 when allowed. */
  retryAfterMs: number
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly clock: Clock

  constructor(limit: number, windowMs: number, clock: Clock = Date.now) {
    this.limit = limit
    this.windowMs = windowMs
    this.clock = clock
  }

  /** Number of keys currently tracked. Exposed for the test that proves the map is pruned. */
  get size(): number {
    return this.hits.size
  }

  /** Records an attempt and says whether it is allowed. A blocked attempt is not recorded. */
  check(key: string): RateLimitResult {
    const now = this.clock()
    const cutoff = now - this.windowMs
    this.prune(cutoff)

    const recent = this.hits.get(key) ?? []
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + this.windowMs - now) }
    }
    recent.push(now)
    this.hits.set(key, recent)
    return { allowed: true, remaining: this.limit - recent.length, retryAfterMs: 0 }
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear()
    else this.hits.delete(key)
  }

  /** Drops expired attempts everywhere, so a key that stops appearing stops costing memory. */
  private prune(cutoff: number): void {
    for (const [key, times] of this.hits) {
      const kept = times.filter((t) => t > cutoff)
      if (kept.length === 0) this.hits.delete(key)
      else this.hits.set(key, kept)
    }
  }
}

export const LOGIN_RATE_LIMIT = 5
export const LOGIN_RATE_WINDOW_MS = 60_000

export const loginRateLimiter = new SlidingWindowLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)
