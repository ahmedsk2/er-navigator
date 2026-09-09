import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, openCase, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The gate screenshots for Phase 2, at both plan viewports. They live in the Playwright suite
 * rather than in `scripts/screenshots.mjs` because two of the three need interaction first (a
 * stage selected, a case resolved), which a URL-only capture cannot do.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase2-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 2 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.61' : '198.51.100.62')
  const taps = await signIn(page, E2E_USERS.navigator)

  await page.goto('/cases/new')
  await expect(page.getByRole('heading', { name: 'New case' })).toBeVisible()
  await shoot(page, 'cases-new', suffix)

  await page.getByRole('button', { name: 'Referral / consulted team' }).click()
  await expect(page.getByRole('heading', { name: 'Department / consulted team involved' })).toBeVisible()
  await shoot(page, 'cases-new-referral', suffix)

  await page.goto('/')
  const url = await openCase(page, uniqueMrn(), 'Admission process', 'No bed available on accepting ward', taps)
  await page.getByLabel('What changed?').fill('Bed assigned on the medical ward')
  await page.getByLabel('What changed?').press('Enter')
  await expect(page.getByText('Bed assigned on the medical ward')).toBeVisible()
  await page.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByRole('heading', { name: 'Resolved' })).toBeVisible()

  await page.goto(url)
  await expect(page.getByRole('button', { name: 'Reopen case' })).toBeVisible()
  await shoot(page, 'case-resolved', suffix)
})
