import { NextResponse, type NextRequest } from 'next/server'

/**
 * Route gate (Next 16's `proxy.ts`, the successor to `middleware.ts`).
 *
 * It is a cheap first pass, not the security boundary: it only looks at whether the session
 * cookie is PRESENT, and redirects to /login when it is not. The real check — is the token in
 * the database, has it expired, is the user still active, may this role do this — happens in
 * `getSession()` / `requireAction()` on the page, layout or server action. Consequently a stale
 * or forged cookie still reaches the page and is rejected there.
 *
 * Since Phase 7 it is also the single source of the Content-Security-Policy, because the policy
 * carries a per-request nonce and a static `next.config.ts` cannot mint one. Everything else in
 * the header set (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) is the same on
 * every response and stays in the config.
 *
 * No database, no crypto beyond the Web Crypto RNG, no `@/src/lib` import here on purpose: the
 * gate runs on every request and must not pull Prisma or React into its bundle.
 * `src/lib/auth/__tests__/route-gate.test.ts` asserts this file and the session module agree on
 * the cookie name.
 */
const SESSION_COOKIE = '__Host-ern_session'
const REMEMBER_COOKIE = '__Host-ern_remember'
/** 12 h, the session TTL. Duplicated from the session module for the same bundle reason. */
const COOKIE_MAX_AGE_S = 12 * 60 * 60

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/health',
  '/api/ready',
  // The PWA (Phase 7). `app/manifest.ts` is served at /manifest.webmanifest; a phone fetches it
  // and the icons before anyone signs in, and a 307 to the login form would break installation.
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/robots.txt',
])

const PUBLIC_PREFIXES = ['/_next/', '/icons/']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

/** The cookie attributes both the app and this gate write; `maxAge: 0` deletes. */
function cookieAttrs(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

// --- Content-Security-Policy ------------------------------------------------------------------

/** 16 random bytes, base64. Web Crypto, so this works on the edge runtime the gate runs on. */
function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * `script-src` carries the nonce and `'strict-dynamic'`: a CSP3 browser then trusts only the
 * scripts this response nonced and whatever those load, and ignores the `'self'` beside them —
 * which is kept for older browsers that do not know `'strict-dynamic'` and would otherwise fall
 * back to nothing. No `'unsafe-inline'` anywhere in `script-src` (Phase 7's whole point).
 *
 * `style-src` keeps `'unsafe-inline'`, and only Recharts is why. Measured on 2026-09-09 by
 * serving `style-src 'self'` and walking the app in Chromium: the board, the case editor and the
 * admin screens reported not one violation — Tailwind compiles to a static stylesheet and
 * next/font's injected `<style>` element takes the nonce — while `/dashboard` reported twenty
 * "Applying inline style violates ..." refusals and rendered no chart at all. Recharts sets
 * `style="..."` ATTRIBUTES on its wrapper and surface elements, and a style attribute can never
 * carry a nonce and is not covered by a hash without `'unsafe-hashes'`. Dropping it would mean
 * dropping the dashboard's charts, so it stays, scoped to styles and never to scripts.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

/**
 * Next reads the nonce for its own inline bootstrap scripts out of the REQUEST's
 * `content-security-policy` header, so the policy has to be set on the request as well as on the
 * response; `x-nonce` is the copy this app's own code reads through `headers()`. Both are set
 * here, from one nonce, on every response the gate returns.
 */
function withCsp(request: NextRequest, build: (init: { request: { headers: Headers } }) => NextResponse): NextResponse {
  const nonce = newNonce()
  const csp = contentSecurityPolicy(nonce)
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  /**
   * Phase 12 (P12): a server component cannot read its own pathname, and `requireUser()` needs
   * it to let /account through while sending every other signed-in page there. Stamped here, on
   * every request the gate returns, from the one place that already rewrites the request headers.
   */
  headers.set('x-pathname', request.nextUrl.pathname)
  headers.set('content-security-policy', csp)
  const response = build({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const signedIn = request.cookies.has(SESSION_COOKIE)

  if (pathname === '/login') {
    if (!signedIn) return withCsp(request, (init) => NextResponse.next(init))
    /**
     * `?expired=1` is what a page's `requireUser()` sends when the cookie is present but the
     * session behind it is gone — deactivated by an Admin (Phase 6), expired, or logged out on
     * another device. Without this the two halves would bounce: the page would redirect to
     * /login because the session is dead, and this gate would redirect back to / because the
     * cookie is alive. A render cannot clear a cookie in Next, but this gate can, so it does.
     */
    if (request.nextUrl.searchParams.has('expired')) {
      const response = withCsp(request, (init) => NextResponse.next(init))
      response.cookies.set(SESSION_COOKIE, '', cookieAttrs(0))
      response.cookies.set(REMEMBER_COOKIE, '', cookieAttrs(0))
      return response
    }
    // Someone already signed in has no business on the login form.
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (isPublic(pathname) || signedIn) {
    const response = withCsp(request, (init) => NextResponse.next(init))
    // A remembered device: slide the browser-side lifetime of both cookies on every request, so
    // a busy shift is never signed out mid-way. The server-side expiry slides in getSession().
    if (signedIn && request.cookies.has(REMEMBER_COOKIE)) {
      const attrs = cookieAttrs(COOKIE_MAX_AGE_S)
      response.cookies.set(SESSION_COOKIE, request.cookies.get(SESSION_COOKIE)!.value, attrs)
      response.cookies.set(REMEMBER_COOKIE, '1', attrs)
    }
    return response
  }

  // A fetch cannot use a 307 to an HTML login page. Route handlers get the status instead, and
  // the handler itself re-checks the session properly (this gate only sees the cookie).
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  }

  const url = new URL('/login', request.url)
  url.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything but the static asset pipeline; the public list above handles the rest.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
