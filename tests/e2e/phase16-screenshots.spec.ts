import { statSync as fileStat } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { seedLiveToken } from './fixtures/forgot'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 16 gate captures, both plan viewports: the "Forgot your password?" link under the
 * sign-in form, the /forgot page, and the /reset form behind a live link.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 *
 * The /reset token is written straight to the database, and on an account this phase's flow spec
 * never touches. Two reasons, both races that would otherwise show up as a screenshot of the
 * expired-link page: issuing a link kills every earlier unused link of that account, so a
 * concurrent /forgot in the flow spec would spend this one out from under the capture, and the
 * three-links-an-hour rule would leave that spec one short on a retry. `e2e_navigator` asks for
 * no links, so a token written for it stays live and is never submitted.
 */
const MIN_BYTES = 8_000

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase16-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(fileStat(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 16 the forgot-password pages', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': mobile ? '203.0.113.81' : '203.0.113.82' })
  // 1. The sign-in screen with the link under the form: the whole of Ahmed's request that a
  //    person can see before they tap anything.
  await page.goto('/login')
  await expect(page.getByRole('link', { name: 'Forgot your password?', exact: true })).toBeVisible()
  await shoot(page, 'login-link', suffix)

  // 2. The one field.
  await page.goto('/forgot')
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible()
  await shoot(page, 'forgot', suffix)

  // 3. The two fields behind a live link, and the sentence about signing every device out.
  const token = await seedLiveToken(E2E_USERS.navigator.username)
  await page.goto(`/reset?token=${encodeURIComponent(token)}`)
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible()
  await shoot(page, 'reset', suffix)
})
