import { expect, test } from '@playwright/test'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 12 item 1 (D6), the production half: with `INSTANCE_LABEL` unset — which is how this
 * suite and production both run — the banner renders nothing at all.
 *
 * This one passes on the day it is written and that is the point: it is the regression guard that
 * says the demo's banner never leaked into the real copy. The demo half lives in
 * `tests/instance/instance.spec.ts`, which starts the same build with the variable set.
 */
test('no instance banner anywhere when INSTANCE_LABEL is unset', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.191' : '198.51.100.192')

  await page.goto('/login')
  await expect(page.locator('[data-instance-banner]')).toHaveCount(0)

  await signIn(page, E2E_USERS.supervisor)
  for (const path of ['/', '/cases/new', '/account', '/dashboard', '/export']) {
    await page.goto(path)
    await expect(page.locator('[data-instance-banner]')).toHaveCount(0)
  }

  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  await page.goto(`/report?from=${to}&to=${to}&status=all`)
  await expect(page.locator('[data-instance-banner]')).toHaveCount(0)
})
