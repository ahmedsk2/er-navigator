import type { NextConfig } from 'next'

/**
 * Security headers per plan section 7, minus the CSP.
 *
 * The Content-Security-Policy is NOT here. It carries a per-request nonce, which a static
 * config cannot mint, so `proxy.ts` builds and sets the whole policy — the one place it lives
 * (Phase 7). Everything below is the same on every response and stays where a config can state
 * it once; `tests/e2e/headers.spec.ts` checks both halves arrive together.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // Phase 10: `microphone=(self)`, not `microphone=()`. The empty allowlist denied the feature
    // to this page as well as to everybody else, which is what the in-app dictation button needs
    // — the Web Speech API is gated on it. `(self)` is this origin and nothing more: no third
    // party may listen, and with `frame-ancestors 'none'` and no cross-origin frame in the
    // document there is no third party to grant it to. Every other feature stays fully denied.
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=(), serial=(), bluetooth=(), hid=(), midi=(), xr-spatial-tracking=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=(), interest-cohort=()',
  },
  // Security audit SPC-WEB-004: isolate the browsing context and stop cross-origin embedding
  // of our responses. Every asset is same-origin, so CORP same-origin costs nothing.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

const nextConfig: NextConfig = {
  // Standalone output only for the Docker image (the Dockerfile sets the env). CI, Playwright
  // and local `next start` use a normal build, which `next start` requires.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Lets a page call `forbidden()` from next/navigation, which answers 403 and renders
    // app/forbidden.tsx. Used by `requireAction()` so a VIEWER on /cases/new gets a status a
    // proxy and a log can see, not a 200 whose body says no (Phase 7).
    authInterrupts: true,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
