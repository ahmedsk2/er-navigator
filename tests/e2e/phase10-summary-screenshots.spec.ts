import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { BOARD_MRN_PREFIX, LONGEST } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Slice 10C gate screenshots at both plan viewports. `scripts/screenshots.mjs` cannot take
 * these: the summary is a panel a tap opens, not a route, and the two shapes worth seeing are the
 * bottom sheet on the phone and the centred dialog on a laptop.
 *
 * Two captures each: the panel opened from a board row (the board behind it, so the gutter the
 * button stands in is visible beside the cards) and the panel opened from the case page's header.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

/**
 * `fullPage` only for the board behind the panel. A dialog is `position: fixed`, so a full-page
 * capture of an open one paints it once at the top and then metres of undimmed page beneath it,
 * which is a picture of nothing anybody sees.
 */
async function shoot(page: Page, name: string, suffix: string, fullPage = false): Promise<void> {
  const path = `design/screens/phase10-summary-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 10 summary gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.91' : '198.51.100.92')
  await signIn(page, E2E_USERS.supervisor)

  // The board, narrowed to the seeded fixtures, with the summary of the longest stay open.
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator(`a[data-mrn="${LONGEST.mrn}"]`)).toBeVisible()
  await shoot(page, 'board', suffix, true)

  await page.locator(`[data-summary-for="${LONGEST.mrn}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(LONGEST.reason.name)
  await shoot(page, 'row', suffix)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // The same panel from the case page, where the trigger sits in the editor header.
  await page.locator(`a[data-mrn="${LONGEST.mrn}"]`).click()
  await expect(page.getByRole('heading', { name: `Case ${LONGEST.mrn}` })).toBeVisible()
  await page.getByRole('button', { name: 'Summary', exact: true }).click()
  await expect(dialog).toBeVisible()
  await shoot(page, 'case', suffix)
})
