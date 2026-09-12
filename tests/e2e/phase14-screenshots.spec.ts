import { statSync as fileStat } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fromClientIp, openCase, recordJourney, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 14 gate captures, both plan viewports: the case page top to bottom with neither the
 * Timeline nor the Updates section on it, and the Resolve block with the two inputs Ahmed asked
 * for, filled.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
// The whole sheet is a big picture; the Resolve block alone is a small one, so the guard is the
// smaller number and each capture is still proven non-blank.
const MIN_BYTES = 8_000

async function shoot(page: Page, name: string, suffix: string, target?: Locator): Promise<void> {
  const path = `design/screens/phase14-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  // A full page unless a section is named: a `fullPage` capture ignores the scroll position, so
  // the two shots below would be the same picture on a laptop where the whole sheet fits.
  if (target) await target.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
  expect(fileStat(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 14 the delay action and the escalation', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '203.0.113.51' : '203.0.113.52')
  const taps = await signIn(page, E2E_USERS.navigator)

  // A worked case, so the capture shows a real sheet rather than a blank one: the journey part
  // way through an admission, the teams section open, and the two new answers filled in.
  const url = await openCase(page, uniqueMrn(), 'Admission process', 'No bed available on accepting ward', taps)
  await recordJourney(page, ['Triage', 'First physician contact', 'Disposition decided'])
  await page
    .getByLabel('What was done to solve the delay', { exact: true })
    .fill('Bed manager called twice; CCU stepped one patient down and is holding bed 4 for 14:00')
  await page
    .getByRole('group', { name: 'Escalated to medical director', exact: true })
    .getByRole('button', { name: 'Yes', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  // 1. The whole sheet, reloaded: identity, Patient journey, the delay, the teams, "More to
  //    record", Resolve, Save. No Timeline section and no Updates section anywhere on it.
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Resolve case', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toHaveCount(0)
  await shoot(page, 'case-page', suffix)

  // 2. The Resolve block itself, with the two inputs above "Final disposition".
  const resolve = page.locator('#case-resolve')
  await page.getByRole('navigation', { name: 'Jump to', exact: true }).getByRole('link', { name: 'Resolve', exact: true }).click()
  await expect(resolve).toBeFocused()
  await shoot(page, 'resolve-inputs', suffix, resolve)
})
