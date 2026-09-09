import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { KEPT_TEXT } from './fixtures/admin-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 6 gate screenshots: the five admin screens at the laptop viewport they are designed
 * for, and the users screen on a phone to prove the same shell still works at 390.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  await prisma.$disconnect()
})

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase6-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 6 gate screenshots', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '198.51.100.111' : '198.51.100.112')
  await signIn(page, E2E_USERS.admin)

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible()
  await shoot(page, 'users', suffix)

  // The remaining admin screens are captured at the laptop viewport they are designed for.
  if (mobile) return

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await shoot(page, 'index', suffix)

  await page.goto('/admin/lists')
  await expect(page.getByRole('heading', { name: 'Departments' })).toBeVisible()
  await shoot(page, 'lists', suffix)

  await page.goto('/admin/other')
  // KEPT_TEXT is the queued description no spec promotes, so this row is here whatever order the
  // suite ran in.
  await expect(page.locator(`[data-other-review="${KEPT_TEXT}"]`)).toBeVisible()
  await shoot(page, 'other', suffix)

  await page.goto('/admin/alerts')
  await expect(page.locator('[data-alert-count]')).toBeVisible()
  await shoot(page, 'alerts', suffix)

  await page.goto('/admin/audit')
  await expect(page.locator('[data-audit-total]')).toBeVisible()
  await shoot(page, 'audit', suffix)
})
