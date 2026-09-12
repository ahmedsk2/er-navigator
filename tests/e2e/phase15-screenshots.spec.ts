import { statSync as fileStat } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fromClientIp, openCase, recordJourney, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 15 gate captures, both plan viewports: the trajectory chip row on the new-case form,
 * the journey block on a transfer and on an admission, and the Final disposition list narrowed
 * with "Show all outcomes" under it.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked. The block-level
 * captures are clipped to `#case-times` or `#case-resolve` rather than taken full-page, because
 * `fullPage` ignores the scroll position and three of these would otherwise be the same picture
 * on a laptop where the whole sheet fits.
 */
const MIN_BYTES = 8_000

async function shoot(page: Page, name: string, suffix: string, target?: Locator): Promise<void> {
  const path = `design/screens/phase15-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  if (target) await target.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
  expect(fileStat(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

const journeyOf = (page: Page) => page.locator('#case-times')
const chip = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Patient trajectory', exact: true }).getByRole('button', { name: label, exact: true })

test('phase 15 the patient trajectory', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '203.0.113.75' : '203.0.113.76')
  const taps = await signIn(page, E2E_USERS.navigator)

  // 1. The new-case form, top to bottom, with the chip row on "Not decided yet" and the block
  //    showing the steps every patient has.
  await page.goto('/cases/new')
  await expect(chip(page, 'Not decided yet')).toHaveAttribute('aria-pressed', 'true')
  await shoot(page, 'new-case-trajectory', suffix)

  // `openCase` starts from the board's "+ New case", and this test is already on the form.
  await page.goto('/')
  const url = await openCase(page, uniqueMrn(), 'Admission process', 'No bed available on accepting ward', taps)

  // 2. A transfer: the fax, the acceptance and the RCC, with two steps already recorded so the
  //    block shows a real stay rather than a column of empty boxes.
  await chip(page, 'Transfer to another facility').click()
  await recordJourney(page, ['Triage', 'First physician contact', 'Transfer requested'])
  await expect(journeyOf(page).getByLabel('Accepted by facility', { exact: true })).toBeVisible()
  await shoot(page, 'journey-transfer', suffix, journeyOf(page))

  // 3. An admission: the same case moved to the other pathway. The transfer time it recorded is
  //    on the "Also recorded" line, which is the whole of the "nothing is lost" rule on screen.
  await chip(page, 'Admission').click()
  await expect(page.locator('[data-also-recorded]')).toContainText('Transfer requested')
  await recordJourney(page, ['Admission order written'])
  await shoot(page, 'journey-admission', suffix, journeyOf(page))

  // 4. The Resolve block on that admission: the Ward chips it brought with it, and the Final
  //    disposition list narrowed to the three ways an admission ends, with the way back under it.
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(url)
  const resolve = page.locator('#case-resolve')
  await page
    .getByRole('navigation', { name: 'Jump to', exact: true })
    .getByRole('link', { name: 'Resolve', exact: true })
    .click()
  await expect(resolve).toBeFocused()
  await expect(page.getByRole('button', { name: 'Show all outcomes', exact: true })).toBeVisible()
  await shoot(page, 'disposition-narrowed', suffix, resolve)
})
