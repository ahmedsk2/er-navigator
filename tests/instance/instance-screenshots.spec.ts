import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, signIn } from '../e2e/fixtures/case-flow'
import { E2E_USERS } from '../e2e/fixtures/seed-users'

/**
 * The Phase 12 gate captures that can only be taken on a labelled instance: the banner on the
 * login hero and on the board, at both plan viewports. The config starts the same production
 * build with `INSTANCE_LABEL=DEMO`, so these are what the hosted demo will look like.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

async function shoot(page: Page, name: string, suffix: string, fullPage = true): Promise<void> {
  const path = `design/screens/phase12-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 12 instance banner gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.215' : '198.51.100.216')

  await page.goto('/login')
  await expect(page.locator('[data-instance-banner]')).toHaveText('DEMO: invented patients only')
  await shoot(page, 'banner-login', suffix)

  await signIn(page, E2E_USERS.navigator)
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await expect(page.locator('a[data-mrn]').first()).toBeVisible()
  await shoot(page, 'banner-board', suffix, false)
})
