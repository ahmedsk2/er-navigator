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
  if (isPublic(pathname) || signedIn) return NextResponse.next()

  const url = new URL('/login', request.url)
  url.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything but the static asset pipeline; the public list above handles the rest.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
