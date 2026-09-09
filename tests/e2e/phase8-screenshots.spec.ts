import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { riyadhDateKey } from '../../src/lib/export/range'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Slice E gate screenshots at both plan viewports: the dashboard with its new panels, one
 * case's timeline, and the printed report. All three need a signed-in session and two of them
 * need a navigation the URL alone cannot make, so they live here rather than in
 * `scripts/screenshots.mjs`.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

/** The seeded case with the fullest record: milestones, a consult, an admission chain, updates. */
const RICH_MRN = '3200001'

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase8-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 8 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.85' : '198.51.100.86')
  // A supervisor: the same dashboard as everyone, and `report.print` as well.
  await signIn(page, E2E_USERS.supervisor)

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Adaa KPIs, tracked cases only' })).toBeVisible()
  // Wait for all three client charts to have drawn before the shutter.
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()
  await expect(page.locator('[data-chart="stacked"] svg[role="application"]')).toBeVisible()
  await shoot(page, 'dashboard', suffix)

  // The case timeline, on the seeded case with the most recorded on it.
  await page.goto(`/?f=all&q=${RICH_MRN}`)
  await page.locator(`a[data-mrn="${RICH_MRN}"]`).click()
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible()
  await expect(page.locator('[data-timeline] [data-timeline-step]').first()).toBeVisible()
  await shoot(page, 'timeline', suffix)

  // The same sequence in the compact form the shift handover actually carries. Not one of the
  // three the spec names, but it is the only picture of the second half of the timeline work.
  await page.goto(`/?f=all&q=${RICH_MRN}`)
  await expect(page.locator(`a[data-mrn="${RICH_MRN}"]`)).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator(`[data-timeline-row="${RICH_MRN}"]`)).toBeVisible()
  await shoot(page, 'handover', suffix)
  await page.emulateMedia({ media: 'screen' })

  // The printed report over the seeded thirty days: headline, stay bands, Adaa, targets, then
  // the rest. Print emulation, because that is the medium it is written for.
  const today = riyadhDateKey(new Date())
  const monthAgo = riyadhDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  await page.goto(`/report?from=${monthAgo}&to=${today}&status=all`)
  await expect(page.locator('[data-report-header]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()

  // The report's own order: the four opening sections come before the threshold table.
  const sections = await page
    .locator('.dash h3')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))
  expect(sections.slice(0, 3)).toEqual(['Stay bands', 'Adaa KPIs, tracked cases only', 'Working targets'])
  expect(sections.indexOf('Cases past each threshold')).toBeGreaterThan(sections.indexOf('Working targets'))
  // The headline tiles sit above all of them, and the range chips are not on a report at all.
  await expect(page.locator('[data-tile="Median stay"]')).toBeVisible()
  await expect(page.getByRole('link', { name: '7 days' })).toHaveCount(0)

  await page.emulateMedia({ media: 'print' })
  await shoot(page, 'report', suffix)
  await page.emulateMedia({ media: 'screen' })
})
