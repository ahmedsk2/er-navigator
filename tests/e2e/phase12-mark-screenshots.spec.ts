import { statSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { riyadhDateKey } from '../../src/lib/export/range'
import { BOARD_MRN_PREFIX } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 12 gate screenshots at both plan viewports: the two paper surfaces that now open with
 * the mark. The report masthead on screen and under print emulation, and the handover sheet — the
 * sheet only exists under print emulation, which no URL-only capture can do, so these live here
 * rather than in `scripts/screenshots.mjs`.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked. These are crops
 * of one element rather than whole pages, so the floor is a quarter of the page floor.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, target: Locator, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase12-mark-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await target.screenshot({ path })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES / 4)
}

test('phase 12 mark-on-paper gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, '198.51.100.254')
  /** The phone project's UA is Safari's, so the install banner would sit over the board. */
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('ern.installBanner.dismissed.v1', '1')
    } catch {
      // A context with storage blocked: the banner shows, which is only a cosmetic difference.
    }
  })
  // A supervisor: the board and its handover sheet like everyone, and `report.print` as well.
  await signIn(page, E2E_USERS.supervisor)

  // 1. The report masthead over the seeded thirty days: on screen, then on paper.
  const today = riyadhDateKey(new Date())
  const monthAgo = riyadhDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  await page.goto(`/report?from=${monthAgo}&to=${today}&status=all`)
  await expect(page.locator('[data-report-header]')).toBeVisible()
  const masthead = page.locator('.dash > header')
  await expect(page.locator('[data-report-mark] svg')).toBeVisible()
  await shoot(page, masthead, 'report-masthead', suffix)

  await page.emulateMedia({ media: 'print' })
  await shoot(page, masthead, 'report-masthead-print', suffix)
  await page.emulateMedia({ media: 'screen' })

  // 2. The handover sheet, which is only ever on paper. The seeded fixtures only: another spec
  //    file may have opened cases against this database while this one runs.
  await page.goto('/')
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator('a[data-mrn]')).toHaveCount(6)

  await page.emulateMedia({ media: 'print' })
  const sheet = page.locator('section.print-only')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-handover-mark] svg')).toBeVisible()
  await shoot(page, sheet, 'handover', suffix)
  await page.emulateMedia({ media: 'screen' })
})
