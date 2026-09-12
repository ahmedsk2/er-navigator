import { statSync as fileStat } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, openCase, openMoreToRecord, recordJourney, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 13 gate captures, both plan viewports: the new-case form as a nurse first meets it,
 * the journey block part way through a stay, "Mark resolved" saying what is still missing, and
 * "More to record" open.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 8_000

async function shoot(page: Page, name: string, suffix: string): Promise<void> {
  const path = `design/screens/phase13-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, fullPage: true })
  expect(fileStat(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 13 the case sheet by patient flow', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'
  await fromClientIp(page, mobile ? '203.0.113.31' : '203.0.113.32')
  const taps = await signIn(page, E2E_USERS.navigator)

  // 1. A blank new case: the identity block, then the journey with its six core steps, then the
  //    delay. "More to record" is one closed row.
  await page.goto('/cases/new')
  await expect(page.getByRole('heading', { name: 'Patient journey', exact: true })).toBeVisible()
  // The "Open case" bar sticks to the foot of the screen (Phase 11, finding 3), and a full-page
  // capture draws it where the viewport is; scrolling to the end first puts it at the end of the
  // form, where it comes to rest, rather than across the middle of the journey block.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shoot(page, 'new-case-blank', suffix)

  // 2. Part way through an admission: four steps recorded and collapsed, the next one highlighted
  //    with its Now button, the admission chain revealed by the stage.
  await page.goto('/')
  await openCase(page, uniqueMrn(), 'Admission process', 'No bed available on accepting ward', taps)
  await recordJourney(page, ['Triage', 'Resus / exam room', 'First physician contact', 'Disposition decided'])
  await expect(page.locator('[data-next-step]')).toContainText('Admission order written')
  await shoot(page, 'journey-midway', suffix)

  // 3. The resolve block with the list of what is still missing, and the required steps tagged.
  await page.getByLabel('Final disposition').selectOption('ADMITTED')
  await expect(page.locator('[data-resolve-missing]')).toBeVisible()
  await shoot(page, 'resolve-missing', suffix)

  // 4. "More to record" open: the shift, the working diagnosis, the payer, pain management and
  //    case management, each with its own conditions.
  await openMoreToRecord(page)
  await page.getByRole('group', { name: 'Painkiller prescribed' }).getByRole('button', { name: 'Yes', exact: true }).click()
  await page.getByRole('group', { name: 'Referred to' }).getByRole('button', { name: 'Case manager', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Pethidine' })).toBeVisible()
  await shoot(page, 'more-expanded', suffix)
})
