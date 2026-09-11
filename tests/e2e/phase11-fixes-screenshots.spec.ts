import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { CASE_URL, fromClientIp, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Slice 11A gate screenshots at both plan viewports: every screen the slice changed, each in
 * the state that shows the change — the sign-in trace, the menu's account row, a new case with the
 * Open case bar at the foot of the screen, a worked case with its time rows and its strip (and the
 * strip after a jump), the board saying "just now", the handover sheet's clock time, the account
 * page and the Users list. The export, Lists and audit selects look exactly as they did, so they
 * have no capture of their own. An administrator takes them all, because only that role reaches
 * every one of those screens.
 *
 * A blank PNG is the failure that bit Phase 0, so every capture is size-checked.
 */
const MIN_BYTES = 12_000

test.describe.configure({ mode: 'serial' })

/**
 * `fullPage` for the screens whose length is the point; the viewport for the states that are about
 * what is on screen at once — a sticky bar or strip is drawn where it would rest at the end of the
 * page in a full-page capture, which is a picture of nothing anybody sees.
 */
async function shoot(page: Page, name: string, suffix: string, fullPage = true): Promise<void> {
  const path = `design/screens/phase11-fixes-${name}-${suffix}.png`
  await page.evaluate(() => document.fonts.ready)
  // A full-page capture paints a sticky element where the page was last scrolled; from the top it
  // is painted where it rests.
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path, fullPage })
  expect(statSync(path).size, `${path} looks blank`).toBeGreaterThan(MIN_BYTES)
}

test('phase 11 fixes gate screenshots', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const mobile = testInfo.project.name === 'mobile'
  const suffix = mobile ? 'mobile-390x844' : 'desktop-1280x800'

  // 1. Sign-in: the trace under the headline block.
  await page.goto('/login')
  await expect(page.locator('[data-login-hero] svg:has(polyline)')).toBeVisible()
  await shoot(page, 'login', suffix, false)

  await fromClientIp(page, mobile ? '198.51.100.237' : '198.51.100.238')
  await signIn(page, E2E_USERS.admin)

  // 2. The menu, open: "Account and password" under the name and role.
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('menuitem', { name: /Account and password$/ })).toBeVisible()
  await shoot(page, 'menu', suffix, false)
  await page.keyboard.press('Escape')

  // 3. A new case the moment the MRN, the stage and the reason are in: the bar at the foot.
  await page.goto('/cases/new')
  const mrn = uniqueMrn()
  await page.getByLabel('MRN (digits only)', { exact: true }).fill(mrn)
  await page.getByRole('group', { name: 'Stages' }).getByRole('button', { name: 'Admission process' }).click()
  await page
    .getByRole('group', { name: 'Admission process reasons' })
    .getByRole('button', { name: 'No bed available on accepting ward' })
    .click()
  await expect(page.getByRole('button', { name: 'Open case', exact: true })).toBeInViewport()
  await shoot(page, 'new-case', suffix, false)

  // 4. The case, worked: a consulted team's times and the admission times, read back from a load.
  await page.getByRole('group', { name: 'Departments' }).getByRole('button', { name: 'CCU', exact: true }).click()
  await page.getByRole('button', { name: 'Open case', exact: true }).click()
  await expect(page).toHaveURL(CASE_URL)
  const registered = await page.getByLabel('Registration time (clock starts here)', { exact: true }).inputValue()
  const at = (minutes: number): string => {
    const time = new Date(`${registered}:00Z`)
    time.setUTCMinutes(time.getUTCMinutes() + minutes)
    return time.toISOString().slice(0, 16)
  }
  const times: ReadonlyArray<readonly [string, number]> = [
    ['Triage', 6],
    ['First physician contact', 40],
    ['Consulted at', 95],
    ['Seen patient at', 130],
    ['Replied / plan given at', 170],
    ['Disposition decided', 185],
    ['Admission order written', 200],
    ['Bed requested (fax sent)', 215],
  ]
  for (const [label, minutes] of times) await page.getByLabel(label, { exact: true }).fill(at(minutes))
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.getByLabel('What changed?', { exact: true }).fill('Bed manager called, CCU bed expected after the ward round')
  await page.getByLabel('What changed?', { exact: true }).press('Enter')
  await expect(page.getByText('Bed manager called, CCU bed expected after the ward round')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: `Case ${mrn}` })).toBeVisible()
  await shoot(page, 'case', suffix)

  // 5. After a jump to Updates: on a phone the strip is stuck to the top over the section.
  await page.getByRole('navigation', { name: 'Jump to', exact: true }).getByRole('link', { name: 'Updates', exact: true }).click()
  await shoot(page, 'case-jump', suffix, false)

  // 6. The board: the case was updated seconds ago, and says so in words.
  await page.goto('/')
  await page.getByLabel('Search MRN').fill(mrn)
  await expect(page.locator(`a[data-mrn="${mrn}"]`)).toContainText('Updated just now')
  await shoot(page, 'board', suffix)

  // 7. The handover sheet: its Last update column is a clock time.
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('section.print-only')).toBeVisible()
  await shoot(page, 'handover', suffix)
  await page.emulateMedia({ media: 'screen' })

  // 8. The account page, with nothing floating over its form; on a laptop the rail's entry is
  //    the current one.
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
  await shoot(page, 'account', suffix)

  // 9. Admin → Users: a card per account on a phone, the table on a laptop.
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible()
  await shoot(page, 'admin-users', suffix)
})
