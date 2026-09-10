import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { BOARD_MRN_PREFIX } from './fixtures/board-cases'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Slice 10B gate screenshots at both plan viewports: the filter panel open — the one state a
 * URL cannot reach, and the whole of the new interface — and the three pages the filter narrows,
 * each showing what it says about being narrowed. They live here rather than in
 * `scripts/screenshots.mjs` for the same reason the Phase 8 set does: two of the four need a
 * navigation and a tap, not an address.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase10-filter-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 10 filter gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.158' : '198.51.100.159')
  // A supervisor: the same board and dashboard as everyone, plus `export.xlsx`.
  await signIn(page, E2E_USERS.supervisor)

  // 1. The panel, open on the board with a stage already chosen: the heading, the two segmented
  //    controls and the stage group — a bottom sheet on the phone, a popover under the button on
  //    a laptop.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await page.getByRole('button', { name: 'Filter' }).click()
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  await expect(panel).toBeVisible()
  await panel.getByRole('group', { name: 'Stage' }).getByRole('button', { name: 'Admission process' }).click()
  // Selecting a chip scrolls it into view; the shot is of the top of the panel, where the heading,
  // the two segmented controls and the stage group are.
  await panel.locator('[data-filter-scroll]').evaluate((el) => el.scrollTo(0, 0))
  await shoot(page, 'panel', suffix)

  // 2. The board under that filter: the chips beside the button and the "{shown} of {total} open
  //    cases" line, over the seeded rows.
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.locator('[data-filter-chip="Stage: Admission process"]')).toBeVisible()
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator('[data-filter-count]')).toBeVisible()
  await shoot(page, 'board', suffix)

  // 3. The dashboard over a filtered population, with the footnote under the headline that says
  //    which filter every figure below is drawn over.
  await page.goto('/dashboard?r=all&payer=INSURED')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('[data-filter-note]')).toHaveText('Filtered: Payer: Insured')
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()
  await shoot(page, 'dashboard', suffix)

  // 4. The export page: the same bar, and a count that is the number of rows the workbook holds.
  await page.goto('/export?payer=INSURED')
  await expect(page.getByRole('heading', { name: 'Export and print' })).toBeVisible()
  await expect(page.locator('[data-export-count]')).toHaveText(/cases? in range$/)
  await shoot(page, 'export', suffix)
})
