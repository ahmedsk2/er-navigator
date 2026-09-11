import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { riyadhDateKey } from '../../src/lib/export/range'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { DASHBOARD_MRNS } from './fixtures/dashboard-cases'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 5 gate screenshots: the export page at both plan viewports, and the printed report on
 * a laptop, which is where a department report is actually produced.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  await prisma.$disconnect()
})

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase5-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 5 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.95' : '198.51.100.96')
  await signIn(page, E2E_USERS.supervisor)

  await page.goto('/export')
  await expect(page.getByRole('heading', { name: 'Export and print' })).toBeVisible()
  await expect(page.locator('[data-export-count]')).toHaveText(/cases? in range$/)
  await shoot(page, 'export', suffix)

  // The report is the one Phase 5 screen the spec pins to the laptop viewport.
  if (mobile) return

  const oldest = await prisma.case.findFirst({
    where: { mrn: { in: [...DASHBOARD_MRNS] } },
    select: { registrationAt: true },
    orderBy: { registrationAt: 'asc' },
  })
  expect(oldest, 'the dashboard fixture is seeded').not.toBeNull()
  const from = riyadhDateKey(oldest!.registrationAt)
  const to = riyadhDateKey(new Date())

  await page.goto(`/report?from=${from}&to=${to}&status=all`)
  await expect(page.locator('[data-report-header]')).toBeVisible()
  // The charts are client components: wait for both to have drawn before the shutter.
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] [data-bar]').first()).toBeVisible()
  await shoot(page, 'report', suffix)
})
