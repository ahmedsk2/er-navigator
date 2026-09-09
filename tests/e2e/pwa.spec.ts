import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The PWA (Phase 7): the manifest and the icons a phone fetches before anyone signs in, and the
 * install banner on the board.
 *
 * The banner has two shapes and this file drives both. Chromium does not fire a real
 * `beforeinstallprompt` for a localhost test server, so the Android shape is triggered with a
 * synthetic event carrying the two members the component uses — which is also the honest way to
 * assert the wiring: preventDefault kept, `prompt()` called on the tap. The iOS shape needs no
 * event at all; it is what the Safari user agent of the `mobile` project produces.
 *
 * The gate screenshots for both shapes are taken here, under `design/screens/phase7-install-*`.
 */
const MIN_BYTES = 12_000

const DISMISSED_KEY = 'ern.installBanner.dismissed.v1'

/** The event the component listens for, with the two members it touches. */
async function fireInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt?: () => Promise<void>
      userChoice?: Promise<{ outcome: string }>
    }
    let prompted = false
    event.prompt = async () => {
      prompted = true
    }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    Object.defineProperty(window, '__ernPrompted', { get: () => prompted, configurable: true })
    window.dispatchEvent(event)
  })
}

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase7-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('the manifest and the icons are reachable without signing in', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough for a static file')

  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)
  expect(manifest.headers()['content-type']).toContain('manifest+json')

  const body = await manifest.json()
  expect(body.name).toBe('ER Navigator')
  expect(body.short_name).toBe('ER Nav')
  expect(body.display).toBe('standalone')
  expect(body.start_url).toBe('/')
  expect(body.theme_color).toBe('#1f7a8c')
  expect(body.background_color).toBe('#f5f7f6')

  const sizes = body.icons.map((icon: { sizes: string }) => icon.sizes)
  expect(sizes).toContain('192x192')
  expect(sizes).toContain('512x512')
  expect(body.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)

  for (const src of ['/icons/icon-192.png', '/icons/icon-512.png', '/apple-touch-icon.png']) {
    const icon = await request.get(src)
    expect(icon.status(), src).toBe(200)
    expect(icon.headers()['content-type'], src).toContain('image/png')
    expect((await icon.body()).byteLength, src).toBeGreaterThan(500)
  }
})

test('the head carries the manifest and the apple touch icon', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the head is the same on both')
  await fromClientIp(page, '198.51.100.121')
  await page.goto('/login')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
})

test('the board offers an install, remembers "Not now", and screenshots both shapes', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.122' : '198.51.100.123')
  await signIn(page, E2E_USERS.navigator)
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()

  // The iOS shape needs nothing but the user agent, so the phone project shows it on arrival and
  // the desktop project shows nothing at all until an event arrives.
  const banner = page.locator('[data-install-banner]')
  if (mobile) {
    await expect(banner).toHaveAttribute('data-install-banner', 'ios')
    await expect(page.getByText('Add to Home Screen')).toBeVisible()
    await shoot(page, 'install-ios', suffix)
  } else {
    await expect(banner).toHaveCount(0)
  }

  // The Android/Chrome shape: the event arrives, the banner offers Install, the tap prompts.
  await fireInstallPrompt(page)
  await expect(banner).toHaveAttribute('data-install-banner', 'prompt')
  await shoot(page, 'install-prompt', suffix)

  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await expect(banner).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __ernPrompted: boolean }).__ernPrompted)).toBe(true)

  // Installing, like dismissing, is remembered on the device — this is a UI preference, and the
  // only thing this app is allowed to keep in localStorage (locked plan section 9).
  expect(await page.evaluate((key) => window.localStorage.getItem(key), DISMISSED_KEY)).toBe('1')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await expect(banner).toHaveCount(0)
  await fireInstallPrompt(page)
  await expect(banner).toHaveCount(0)
})

test('"Not now" is enough on its own to keep the banner away', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the banner is a phone feature')
  await fromClientIp(page, '198.51.100.124')
  await signIn(page, E2E_USERS.navigator)

  const banner = page.locator('[data-install-banner]')
  await expect(banner).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss the install suggestion' }).click()
  await expect(banner).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await expect(banner).toHaveCount(0)
})
