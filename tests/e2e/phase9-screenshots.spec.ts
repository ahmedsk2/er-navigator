import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 9 gate screenshots a URL cannot take on its own (`scripts/screenshots.mjs` covers
 * the sign-in, which is reachable signed out): the refusal screen needs a signed-in role that is
 * refused, and it has two shapes worth seeing side by side. A NAVIGATOR refused at /report is
 * outside the shell and gets `app/forbidden.tsx` — the wordmark band over a card, which is the
 * new design; the same navigator refused at /export is inside the shell and gets
 * `app/(app)/forbidden.tsx`, the card alone under the header that is already there.
 */
const MIN_BYTES = 12_000

async function shoot(page: Page, name: string): Promise<void> {
  const path = `design/screens/phase9-${name}-desktop-1280x800.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 9 gate screenshots: the refusal screen, bare and inside the shell', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one viewport is enough for a holding screen')
  await fromClientIp(page, '198.51.100.131')
  await signIn(page, E2E_USERS.navigator)

  const bare = await page.goto('/report')
  expect(bare?.status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await shoot(page, 'forbidden')

  const inShell = await page.goto('/export')
  expect(inShell?.status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible()
  // Next renders a forbidden() thrown below a layout within that layout, so this refusal already
  // has the shell's header above it: the card must come alone, or the app prints its own name
  // twice on the same screen.
  await expect(page.getByText('ER Navigator', { exact: true })).toHaveCount(1)
  await shoot(page, 'forbidden-shell')
})
