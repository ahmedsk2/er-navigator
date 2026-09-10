// Gate screenshots at the two plan viewports. Usage:
//   node scripts/screenshots.mjs <label> [baseUrl] [route...]
// Writes design/screens/<label>-<route>-{mobile-390x844,desktop-1280x800}.png
//
// Signed-in routes (Phase 1 onward): set SHOT_USERNAME and SHOT_PASSWORD and the script signs in
// once through the real login form, then reuses that cookie for every route except /login, which
// is always captured signed out. Without the variables it behaves exactly as before.
//
// Guards against the failure that bit Phase 0 (blank PNGs committed as a baseline): every capture
// waits for the page's h1, and a PNG smaller than MIN_BYTES fails the run loudly.
//
// Git Bash rewrites a bare "/" argument into a Windows path; pass routes as "home" or "/cases".
import { chromium, devices } from '@playwright/test'
import { mkdirSync, statSync } from 'node:fs'

const MIN_BYTES = 12_000
const [label = 'shot', baseUrl = 'http://localhost:3000', ...rawRoutes] = process.argv.slice(2)
const routes = (rawRoutes.length ? rawRoutes : ['home']).map((r) => (r === 'home' || r === '/' ? '/' : r.startsWith('/') ? r : `/${r}`))
mkdirSync('design/screens', { recursive: true })
const browser = await chromium.launch()
const targets = [
  ['mobile-390x844', { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } }],
  ['desktop-1280x800', { viewport: { width: 1280, height: 800 } }],
]

// One sign-in for the whole run: the login form is rate limited to 5 attempts a minute per IP,
// and four captures of two protected routes would sit right on that limit.
let storageState
const username = process.env.SHOT_USERNAME
const password = process.env.SHOT_PASSWORD
if (username && password) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'networkidle' })
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(new URL('/', baseUrl).toString(), { timeout: 15_000 })
  storageState = await ctx.storageState()
  await ctx.close()
  console.log(`signed in as ${username} for the authenticated routes`)
}

let failed = false
for (const route of routes) {
  const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-')
  const authed = storageState && route !== '/login'
  for (const [name, opts] of targets) {
    const ctx = await browser.newContext(authed ? { ...opts, storageState } : opts)
    const page = await ctx.newPage()
    await page.goto(new URL(route, baseUrl).toString(), { waitUntil: 'networkidle' })
    // A *visible* h1. Since Phase 9 the signed-in shell carries two — the rail's wordmark and the
    // header's — and each is `display: none` at the width the other is drawn at, so the first one
    // in the DOM is the hidden one on a phone and this guard would time out on every mobile shot.
    await page.locator('h1:visible').first().waitFor({ timeout: 10_000 })
    await page.evaluate(() => document.fonts.ready)
    const file = `design/screens/${label}-${slug}-${name}.png`
    await page.screenshot({ path: file, fullPage: true })
    const bytes = statSync(file).size
    if (bytes < MIN_BYTES) {
      console.error(`${file}: ${bytes} bytes, looks blank`)
      failed = true
    } else {
      console.log(`${file} (${bytes} bytes)`)
    }
    await ctx.close()
  }
}
await browser.close()
if (failed) process.exit(1)
