import { expect, test } from '@playwright/test'
import { BOARD_MRN_PREFIX } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * One navigation, two shapes (Phase 9, Slice 9B). The same `nav[aria-label="Sections"]` with the
 * same four links is a bottom tab bar on the phone and a left rail on the laptop, and the content
 * beside the rail is the full width of the screen rather than the phone column it used to be.
 *
 * These are geometry assertions on purpose: every other spec in this suite proves the links are
 * there and go where they say. What Phase 9 changed is where they sit, and a class name is not
 * evidence of that — a bounding box is.
 */
test('the navigation is a rail on the laptop and a tab bar on the phone', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.131' : '198.51.100.132')
  await signIn(page, E2E_USERS.navigator)
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)

  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expect(nav).toBeVisible()
  const navBox = await nav.boundingBox()
  expect(navBox).not.toBeNull()

  const row = page.locator('a[data-mrn]').first()
  await expect(row).toBeVisible()
  const rowBox = await row.boundingBox()
  expect(rowBox).not.toBeNull()

  if (mobile) {
    // The bar is at the foot of an 844 px viewport, under the rows.
    expect(navBox!.y).toBeGreaterThan(700)
    expect(rowBox!.y).toBeLessThan(navBox!.y)
  } else {
    // The rail: hard left, full height, and the rows now have the rest of the 1280.
    expect(navBox!.x).toBeLessThan(240)
    expect(navBox!.height).toBeGreaterThan(400)
    expect(rowBox!.width).toBeGreaterThan(700)
    expect(rowBox!.x).toBeGreaterThan(navBox!.x + navBox!.width - 1)
  }
})

test('the header trigger carries the initials and still opens the same menu', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.133' : '198.51.100.134')
  await signIn(page, E2E_USERS.supervisor)

  // "Sami Supervisor" → SS, drawn in the circle; the accessible name of the trigger is unchanged.
  const trigger = page.getByRole('button', { name: 'Menu' })
  await expect(trigger).toContainText('SS')
  await trigger.click()
  await expect(page.getByRole('menuitem', { name: `${E2E_USERS.supervisor.displayName} · Supervisor` })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Print handover' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
})

test('the rail names the signed-in user, and the phone does not', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.135' : '198.51.100.136')
  await signIn(page, E2E_USERS.navigator)

  const nav = page.getByRole('navigation', { name: 'Sections' })
  const block = nav.getByText(E2E_USERS.navigator.displayName, { exact: true })
  if (mobile) {
    // The block is in the markup, but a 390 px tab bar has no room for it.
    await expect(block).toBeHidden()
  } else {
    await expect(block).toBeVisible()
    await expect(nav.getByText('Navigator', { exact: true })).toBeVisible()
  }
})
