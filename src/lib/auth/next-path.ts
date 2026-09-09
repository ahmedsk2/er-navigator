/**
 * Where to send someone after they sign in.
 *
 * The route gate puts the page a signed-out visitor asked for onto `/login?next=...`, and the
 * login form posts it back. Anything that is not a plain in-app path is thrown away and the
 * board is used instead. The value is RESOLVED, not pattern-matched: a browser strips ASCII
 * tabs and newlines before it parses a Location header, so `/<TAB>//evil.example` is
 * `//evil.example` to the browser while starting with a single `/` to a string check (final
 * review 2026-09-09, C7). Parsing it against a placeholder origin and requiring that origin
 * back normalises tabs, newlines, backslashes and every future encoding trick in one step.
 */
const PLACEHOLDER = 'https://placeholder.invalid'

export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '/'
  if (!value.startsWith('/')) return '/'
  let url: URL
  try {
    url = new URL(value, PLACEHOLDER)
  } catch {
    return '/'
  }
  if (url.origin !== PLACEHOLDER || url.username || url.password) return '/'
  const pathname = url.pathname
  // A resolved path always starts with one slash; the second check is belt and braces.
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  // Never bounce a fresh sign-in back onto the login form.
  if (pathname === '/login') return '/'
  return `${pathname}${url.search}`
}
