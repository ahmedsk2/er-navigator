import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { BOARD_MRN_PREFIX } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 3 gate screenshots at both plan viewports: the board with the eight seeded cases,
 * the Resolved tab, and the handover sheet under print emulation — which no URL-only capture can
 * do, so these live here rather than in `scripts/screenshots.mjs`.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase3-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 3 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.81' : '198.51.100.82')
  await signIn(page, E2E_USERS.navigator)

  // The seeded fixtures only: another spec file may have opened cases against the same database.
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator('a[data-mrn]')).toHaveCount(6)
  await shoot(page, 'board', suffix)

  await page.getByRole('link', { name: 'All', exact: true }).click()
  await expect(page.locator('a[data-mrn]')).toHaveCount(8)
  await shoot(page, 'board-all', suffix)

  await page.getByRole('link', { name: 'Resolved', exact: true }).click()
  await expect(page.locator('a[data-mrn]')).toHaveCount(2)
  await shoot(page, 'board-resolved', suffix)

  // The handover sheet: same rows, on paper.
  await page.getByRole('link', { name: 'Open', exact: true }).click()
  await expect(page.locator('a[data-mrn]')).toHaveCount(6)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('section.print-only')).toBeVisible()
  await shoot(page, 'handover', suffix)
  await page.emulateMedia({ media: 'screen' })

  // The empty state, with its exact copy.
  await page.getByLabel('Search MRN').fill('')
  await page.getByRole('link', { name: 'Resolved', exact: true }).click()
  await page.getByLabel('Search MRN').fill('3100099')
  await expect(page.getByText('No case matching 3100099.')).toBeVisible()
  await shoot(page, 'board-empty', suffix)
})
