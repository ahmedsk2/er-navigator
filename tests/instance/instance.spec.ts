import { expect, test } from '@playwright/test'
import { fromClientIp, signIn } from '../e2e/fixtures/case-flow'
import { E2E_USERS } from '../e2e/fixtures/seed-users'

/**
 * Phase 12 item 1 (D6), the demo half. Run by `tests/instance/playwright.instance.config.ts`,
 * which starts the same production build with `INSTANCE_LABEL=DEMO`. Everything here fails
 * against a build without the banner, which is what makes it the fail-first proof.
 *
 * The counterpart, `tests/e2e/instance-banner.spec.ts`, proves the banner is absent with the
 * variable unset — the two together are the whole contract.
 */
const TEXT = 'DEMO: invented patients only'

test('the login hero carries the banner above it, and still has one ER Navigator heading', async ({
  page,
}, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.201' : '198.51.100.202')
  await page.goto('/login')

  const banner = page.locator('[data-instance-banner]')
  await expect(banner).toHaveCount(1)
  await expect(banner).toHaveText(TEXT)

  const hero = page.locator('[data-login-hero]')
  const bannerBox = await banner.boundingBox()
  const heroBox = await hero.boundingBox()
  expect(bannerBox).not.toBeNull()
  expect(heroBox).not.toBeNull()
  expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(heroBox!.y + 1)

  // The banner is a <div>, not a heading: the suite's count of this heading must not move.
  await expect(page.getByRole('heading', { name: 'ER Navigator' })).toHaveCount(1)
})

test('the board still fits under the banner, and every signed-in page carries one', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.203' : '198.51.100.204')
  await signIn(page, E2E_USERS.supervisor)

  await expect(page.locator('[data-instance-banner]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  // The banner is in flow, so it costs one banner height at the top; the shell must not be
  // pushed off a 390 x 844 phone by it.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await expect(page.locator('a[data-mrn]').first()).toBeVisible()

  for (const path of ['/cases/new', '/account', '/dashboard', '/export']) {
    await page.goto(path)
    await expect(page.locator('[data-instance-banner]')).toHaveCount(1)
  }

  const today = new Date().toISOString().slice(0, 10)
  await page.goto(`/report?from=${today}&to=${today}&status=all`)
  await expect(page.locator('[data-instance-banner]')).toHaveCount(1)
})

test('it cannot be dismissed and survives a reload', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.205' : '198.51.100.206')
  await page.goto('/login')

  const banner = page.locator('[data-instance-banner]')
  await expect(banner.locator('button')).toHaveCount(0)
  await expect(banner.locator('a')).toHaveCount(0)
  await page.reload()
  await expect(banner).toHaveCount(1)
})

test('the pages stay noindex', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.207' : '198.51.100.208')
  await page.goto('/login')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')

  await signIn(page, E2E_USERS.navigator)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})

test('it survives the printer', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.209' : '198.51.100.210')
  await signIn(page, E2E_USERS.navigator)
  await page.emulateMedia({ media: 'print' })

  const banner = page.locator('[data-instance-banner]')
  await expect(banner).toBeVisible()
  // Without this a browser that drops background graphics prints white text on white paper — a
  // demo handover sheet indistinguishable from a real one.
  await expect(banner).toHaveCSS('print-color-adjust', 'exact')
})
