import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { riyadhDateKey } from '../../src/lib/export/range'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Slice 11B gate screenshots at both plan viewports: the dashboard as a whole (the groups, the
 * two-column grid on a laptop, the jump chips on a phone), its new figures up close — the Adaa
 * bullet charts, the stay split, the days and the arrivals table — two of the new drill-downs, and
 * the same page and the report on paper, where both are one column. They live here rather than in
 * `scripts/screenshots.mjs` because most need a signed-in session and a tap.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked. The page heights
 * are logged, because "thirteen screens long" was the finding this slice answers.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

async function shoot(page: Page, name: string, suffix: string, fullPage = true): Promise<void> {
  const path = `design/screens/phase11-dashboard-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

/** One section, cut out of the page: the new figures at the size they are read at. */
async function shootSection(page: Page, title: string, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase11-dashboard-${name}-${suffix}.png`
  const section = page.getByRole('heading', { name: title, exact: true }).locator('xpath=..')
  await section.scrollIntoViewIfNeeded()
  await section.screenshot({ path })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES / 4)
}

test('phase 11 dashboard gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, '198.51.100.247')
  // A supervisor: the same dashboard as everyone, and `report.print` as well.
  await signIn(page, E2E_USERS.supervisor)

  // 1. The whole page over the default thirty days: the groups, the jump chips or the two columns.
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.locator('[data-chart="daily"] [data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="stacked"] svg[role="application"]')).toBeVisible()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  console.log(`[phase11] /dashboard is ${height} px tall at ${suffix}`)
  await shoot(page, 'page', suffix)

  // 2. The new figures, one section each.
  await shootSection(page, 'Adaa KPIs, tracked cases only', 'adaa', suffix)
  await shootSection(page, 'Where the time goes', 'stay-split', suffix)
  await shootSection(page, 'By day: cases and median stay', 'by-day', suffix)
  await shootSection(page, 'Arrivals by day and time', 'arrivals', suffix)
  await shootSection(page, 'Primary delay reason', 'bars', suffix)

  // 3. A phone's jump: the KPIs chip, and the screen it lands on.
  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('navigation', { name: 'Jump to a section' }).getByRole('link', { name: 'KPIs' }).click()
    await expect(page).toHaveURL(/#dash-kpis$/)
    await shoot(page, 'jump-kpis', suffix, false)
  }

  // 4. Seven days, the shortest range: eight bars, one per Riyadh day.
  await page.goto('/dashboard?r=7')
  await expect(page.locator('[data-chart="daily"]')).toHaveAttribute('data-points', '8')
  await expect(page.locator('[data-chart="daily"] [data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await shootSection(page, 'By day: cases and median stay', 'by-day-7', suffix)

  // 5. Two of the new drill-downs: the fullest cell of the arrivals table, and a day.
  await page.goto('/dashboard')
  const fullest = page.locator('td[data-step="4"] a').first()
  await expect(fullest).toBeVisible()
  await fullest.click()
  await expect(page.locator('[data-drill-label]')).toHaveText(/^Arrivals on /)
  await expect(page.locator('a[data-mrn]').first()).toBeVisible()
  await shoot(page, 'drill-arrival', suffix)
  await page.goto('/dashboard')
  const dayLink = page.locator('[data-chart="daily"] ~ ul a').last()
  await page.goto((await dayLink.getAttribute('href')) ?? '/dashboard')
  await expect(page.locator('[data-drill-label]')).toHaveText(/^Registered on /)
  await shoot(page, 'drill-day', suffix)

  // 6. The page on paper: one column, no chips, every section kept.
  await page.goto('/dashboard')
  await expect(page.locator('[data-chart="daily"] [data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toBeHidden()
  await shoot(page, 'print', suffix)
  await page.emulateMedia({ media: 'screen' })

  // 7. The report over the seeded thirty days, on paper: its own order, one column, the new
  //    figures inside the sections they belong to and the arrivals table after "By day of week".
  const today = riyadhDateKey(new Date())
  const monthAgo = riyadhDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  await page.goto(`/report?from=${monthAgo}&to=${today}&status=all`)
  await expect(page.locator('[data-report-header]')).toBeVisible()
  await expect(page.locator('[data-chart="bullets"]')).toBeVisible()
  await expect(page.locator('[data-chart="weekly"] [data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await shoot(page, 'report', suffix)
  await page.emulateMedia({ media: 'screen' })
})
