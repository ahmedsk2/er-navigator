import { expect, test } from '@playwright/test'

/**
 * The response headers, on the one page a signed-out visitor can reach (Phase 7).
 *
 * The Content-Security-Policy is built per request in `proxy.ts` because it carries a nonce;
 * everything else comes from `next.config.ts`. This asserts both halves arrive on the same
 * response, that `script-src` has a fresh nonce and `'strict-dynamic'` and no `'unsafe-inline'`,
 * and that Next actually stamped that nonce onto its own scripts — the whole point of the
 * exercise. `style-src` keeps `'unsafe-inline'` for Recharts' inline style attributes; the
 * comment in `proxy.ts` records the measurement.
 */
const NONCE = /'nonce-[A-Za-z0-9+/]{20,}={0,2}'/

test.describe.configure({ mode: 'parallel' })

test('the login page is served with the full security header set', async ({ request }) => {
  const response = await request.get('/login')
  expect(response.status()).toBe(200)
  const headers = response.headers()

  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  for (const feature of ['camera', 'geolocation', 'payment', 'usb', 'display-capture', 'browsing-topics']) {
    expect(headers['permissions-policy'], feature).toContain(`${feature}=()`)
  }
  // Phase 10: the one feature this app uses. `microphone=(self)` lets the dictation button's Web
  // Speech API run on this origin — `microphone=()` denied it to the page itself — and grants it
  // to nobody else, which the second assertion pins.
  expect(headers['permissions-policy']).toContain('microphone=(self)')
  expect(headers['permissions-policy']).not.toContain('microphone=*')
  // Security audit SPC-WEB-004: browsing-context isolation and no cross-origin embedding.
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  // next.config.ts sets poweredByHeader: false.
  expect(headers['x-powered-by']).toBeUndefined()

  const csp = headers['content-security-policy']
  expect(csp, 'the proxy must set exactly one CSP').toBeTruthy()
  const directives = new Map(
    csp!.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name!, values.join(' ')] as const
    }),
  )

  expect(directives.get('default-src')).toBe("'self'")
  expect(directives.get('script-src')).toMatch(NONCE)
  expect(directives.get('script-src')).toContain("'strict-dynamic'")
  expect(directives.get('script-src')).not.toContain('unsafe-inline')
  expect(directives.get('script-src')).not.toContain('unsafe-eval')
  expect(directives.get('style-src')).toBe("'self' 'unsafe-inline'")
  expect(directives.get('img-src')).toBe("'self' data:")
  expect(directives.get('font-src')).toBe("'self'")
  expect(directives.get('connect-src')).toBe("'self'")
  expect(directives.get('frame-ancestors')).toBe("'none'")
  expect(directives.get('base-uri')).toBe("'self'")
  expect(directives.get('form-action')).toBe("'self'")
  expect(directives.get('object-src')).toBe("'none'")

  // The nonce in the header is the one Next put on its own scripts, and every script has it.
  const nonce = /'nonce-([^']+)'/.exec(directives.get('script-src')!)?.[1]
  expect(nonce).toBeTruthy()
  const html = await response.text()
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  for (const tag of scripts) expect(tag, tag).toContain(`nonce="${nonce}"`)
})

test('the nonce is fresh on every request', async ({ request }) => {
  const nonceOf = async (): Promise<string> => {
    const csp = (await request.get('/login')).headers()['content-security-policy'] ?? ''
    return /'nonce-([^']+)'/.exec(csp)?.[1] ?? ''
  }
  const first = await nonceOf()
  const second = await nonceOf()
  expect(first).not.toBe('')
  expect(first).not.toBe(second)
})
