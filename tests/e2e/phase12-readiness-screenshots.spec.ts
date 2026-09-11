import { randomBytes } from 'node:crypto'
import { statSync as fileStat } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { ALERT_MRN, ALERT_THRESHOLD_HOURS } from './fixtures/admin-cases'
import { fromClientIp, openCase, signIn, Taps, uniqueMrn } from './fixtures/case-flow'
import { E2E_TEMP_USER_PREFIX, E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 12 gate captures that do not need a labelled instance: the /account notice a new
 * account meets on its first sign-in, the five "MRN only, no names" hints on a worked case, and
 * Admin → Alerts showing an email that has failed twice. Both plan viewports, except the admin
 * screen, which is a laptop.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 8_000

async function shoot(page: Page, name: string, suffix: string, fullPage = true): Promise<void> {
  const path = `design/screens/phase12-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage })
  expect(fileStat(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 12 must-change notice', async ({ browser, page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  const username = `${E2E_TEMP_USER_PREFIX}${randomBytes(4).toString('hex')}`
  await fromClientIp(page, mobile ? '198.51.100.251' : '198.51.100.252')

  await signIn(page, E2E_USERS.admin)
  await page.goto('/admin/users')
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Display name', { exact: true }).fill('Temporary Navigator')
  await page.getByLabel('Role', { exact: true }).selectOption('NAVIGATOR')
  await page.getByRole('button', { name: 'Create user', exact: true }).click()
  const secret = page.locator('[data-temporary-password] [data-secret]')
  await expect(secret).toBeVisible()
  const temporary = (await secret.innerText()).trim()

  const theirs = await browser.newContext()
  const their = await theirs.newPage()
  await fromClientIp(their, mobile ? '198.51.100.253' : '198.51.100.254')
  await their.goto('/login')
  await their.getByLabel('Username').fill(username)
  await their.getByLabel('Password', { exact: true }).fill(temporary)
  await their.getByRole('button', { name: 'Sign in' }).click()
  await expect(their).toHaveURL(/\/account$/)
  await expect(their.locator('[data-must-change]')).toBeVisible()
  await shoot(their, 'must-change', suffix)
  await theirs.close()
})

test('phase 12 the five MRN-only hints on a worked case', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.255' : '198.51.100.256')

  const taps = new Taps()
  await signIn(page, E2E_USERS.supervisor, taps)
  await openCase(page, uniqueMrn(), 'Admission process', 'No bed available on accepting ward', taps)

  // Three by default; the "Other" chip opens a fourth and the void panel a fifth.
  await page
    .getByRole('group', { name: 'Admission process reasons' })
    .getByRole('button', { name: 'Other', exact: true })
    .click()
  await page.getByRole('button', { name: 'Void', exact: true }).click()
  await expect(page.locator('[data-mrn-hint]')).toHaveCount(5)
  await shoot(page, 'mrn-hints', suffix)
})

test('phase 12 an alert whose email keeps failing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'administration is done on a laptop')
  await fromClientIp(page, '198.51.100.257')
  await signIn(page, E2E_USERS.admin)

  await page.goto('/admin/alerts')
  const row = page.locator('tr', { hasText: `${ALERT_THRESHOLD_HOURS}h` }).filter({ hasText: ALERT_MRN })
  await expect(row.first().getByText(/^Failed ×\d+$/)).toBeVisible()
  await shoot(page, 'alert-email-failed', 'desktop-1280x800')
})
