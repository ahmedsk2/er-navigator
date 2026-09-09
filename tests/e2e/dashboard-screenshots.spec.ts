import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 4 gate screenshots at both plan viewports: the dashboard with the seeded twenty-nine
 * days of cases, one drill-down, and the dashboard under print emulation — which no URL-only
 * capture can do, so these live here rather than in `scripts/screenshots.mjs`.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase4-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 4 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.83' : '198.51.100.84')
  await signIn(page, E2E_USERS.navigator)

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  // The charts are client components: wait for both to have drawn before the shutter.
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()
  // Phase 8 added two: the stay bands at the top and the outcome mix that replaced "Final
  // disposition". Six horizontal-bar charts, in the order the page lists them.
  await expect(page.locator('[data-chart="hbar"]')).toHaveCount(6)
  await shoot(page, 'dashboard', suffix)

  await page.getByRole('link', { name: 'Over 12h' }).click()
  await expect(page.locator('[data-drill-label]')).toHaveText('Cases over 12h')
  await expect(page.locator('a[data-mrn]').first()).toBeVisible()
  await shoot(page, 'drill', suffix)

  // The same page on paper: chips and the back button gone, every section kept.
  await page.goto('/dashboard')
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('link', { name: '7 days' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Outcomes' })).toBeVisible()
  await shoot(page, 'print', suffix)
  await page.emulateMedia({ media: 'screen' })
})
