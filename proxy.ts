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
 * No database, no crypto, no `@/src/lib` import here on purpose: the gate runs on every request
 * and must not pull Prisma or React into its bundle. `src/lib/auth/__tests__/session.test.ts`
 * asserts this file and the session module agree on the cookie name.
 */
const SESSION_COOKIE = 'ern_session'
const REMEMBER_COOKIE = 'ern_remember'
/** 12 h, the session TTL. Duplicated from the session module for the same bundle reason. */
const COOKIE_MAX_AGE_S = 12 * 60 * 60

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/health',
  '/api/ready',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/robots.txt',
])

const PUBLIC_PREFIXES = ['/_next/', '/icons/']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const signedIn = request.cookies.has(SESSION_COOKIE)

  // Someone already signed in has no business on the login form.
  if (pathname === '/login') {
    return signedIn ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next()
  }
  if (isPublic(pathname) || signedIn) {
    const response = NextResponse.next()
    // A remembered device: slide the browser-side lifetime of both cookies on every request, so
    // a busy shift is never signed out mid-way. The server-side expiry slides in getSession().
    if (signedIn && request.cookies.has(REMEMBER_COOKIE)) {
      const attrs = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: COOKIE_MAX_AGE_S }
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
