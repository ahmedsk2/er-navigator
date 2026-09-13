import { expect, test, type Page } from '@playwright/test'
import { fromClientIp, openCase, recordJourney, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 15: the patient trajectory (`docs/specs/phase15-trajectory.md`; Ahmed, 12 September 2026).
 *
 * "For patient journey time inputs, some are suitable for discharged patients and some for
 * admitted patients only and others for referred patients to other facility like the fax sent at
 * and accepted at and RCC transferred the patient at. Same goes for other categories in different
 * labels. Hide them and show what is related based on patient trajectory."
 *
 * Both plan viewports, like the Phase 13 and Phase 14 suites, because what this phase changes is
 * the shape of the sheet and the shape is what differs between a phone and a laptop.
 */
const STAGE = 'Discharge process'
const REASON = 'Awaiting pharmacy'

const CORE = ['triageAt', 'roomAt', 'physicianAt', 'decisionAt', 'departedAt', 'medAdminInformedAt'] as const
const ADMISSION = ['admOrderAt', 'bedRequestedAt', 'bedAssignedAt'] as const
const TRANSFER = ['transferRequestedAt', 'transferAcceptedAt', 'transportArrivedAt'] as const

const journeyOf = (page: Page) => page.locator('#case-times')
const trajectoryRow = (page: Page) => page.getByRole('group', { name: 'Patient trajectory', exact: true })
const chip = (page: Page, label: string) =>
  trajectoryRow(page).getByRole('button', { name: label, exact: true })

/** Every step the block is showing, collapsed or open, in the order it draws them. */
async function shownSteps(page: Page): Promise<string[]> {
  return journeyOf(page)
    .locator('[data-journey-step]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-journey-step') ?? ''))
}

/** The outcomes the Final disposition select is offering, by their visible text. */
async function outcomes(page: Page): Promise<string[]> {
  return page
    .getByLabel('Final disposition', { exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((o) => o.textContent ?? '').filter((t) => t !== 'Select'))
}

/** Chrome answers horizontal overflow by shrinking the page, which is easy to miss. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1)
}

/**
 * Decision A: the chip row is the first thing in the Patient journey block, on the new-case form
 * as well, and a case starts on "Not decided yet" showing the steps every patient has.
 */
test('a new case opens on Not decided yet, with the core steps alone', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.61' : '203.0.113.62')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/cases/new')

  const row = trajectoryRow(page)
  await expect(row).toBeVisible()
  await expect(row.getByRole('button')).toHaveText([
    'Not decided yet',
    'Discharge',
    'Admission',
    'Transfer to another facility',
  ])
  await expect(chip(page, 'Not decided yet')).toHaveAttribute('aria-pressed', 'true')
  for (const label of ['Discharge', 'Admission', 'Transfer to another facility']) {
    await expect(chip(page, label), label).toHaveAttribute('aria-pressed', 'false')
  }

  // It is inside the journey block and above every step in it.
  await expect(journeyOf(page).getByRole('group', { name: 'Patient trajectory', exact: true })).toHaveCount(1)
  const chips = (await row.boundingBox())!
  const first = (await journeyOf(page).locator('[data-journey-step]').first().boundingBox())!
  expect(chips.y).toBeLessThan(first.y)

  expect(await shownSteps(page)).toEqual([...CORE])
  await expectNoSidewaysScroll(page)
})

/**
 * Decision B, the request itself: an admission is asked for the admission order and the bed, and
 * a transfer for the fax, the acceptance and the RCC — and neither is asked for the other's.
 */
test('the trajectory decides which steps the block asks for', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.63' : '203.0.113.64')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await chip(page, 'Discharge').click()
  expect(await shownSteps(page)).toEqual([...CORE])

  await chip(page, 'Admission').click()
  expect(await shownSteps(page)).toEqual([
    'triageAt',
    'roomAt',
    'physicianAt',
    'decisionAt',
    ...ADMISSION,
    'departedAt',
    'medAdminInformedAt',
  ])
  for (const label of ['Admission order written', 'Bed requested', 'Bed assigned']) {
    await expect(journeyOf(page).getByLabel(label, { exact: true }), label).toBeVisible()
  }
  await expect(journeyOf(page).getByLabel('Fax sent', { exact: true })).toHaveCount(0)

  await chip(page, 'Transfer to another facility').click()
  expect(await shownSteps(page)).toEqual([
    'triageAt',
    'roomAt',
    'physicianAt',
    'decisionAt',
    ...TRANSFER,
    'departedAt',
    'medAdminInformedAt',
  ])
  // Ahmed's own three: the fax, the acceptance and the RCC.
  for (const label of ['Fax sent', 'Accepted by facility', 'RCC / transport arrived']) {
    await expect(journeyOf(page).getByLabel(label, { exact: true }), label).toBeVisible()
  }
  await expect(journeyOf(page).getByLabel('Admission order written', { exact: true })).toHaveCount(0)

  // Tapping the pressed chip puts the case back to "Not decided yet", and the block with it.
  await chip(page, 'Transfer to another facility').click()
  await expect(chip(page, 'Not decided yet')).toHaveAttribute('aria-pressed', 'true')
  expect(await shownSteps(page)).toEqual([...CORE])

  await expectNoSidewaysScroll(page)
})

/**
 * Decision D: the other blocks follow. A transfer opens "Referral out" with no referral reason and
 * no outcome; an admission puts the Ward chips in the Resolve section before anything is resolved.
 */
test('Referral out follows a transfer, and the Ward follows an admission', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.65' : '203.0.113.66')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  // The delay reason is a pharmacy one, so nothing on this case asks for a referral number yet.
  await expect(page.getByRole('heading', { name: 'Referral out', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Ward', exact: true })).toHaveCount(0)

  await chip(page, 'Transfer to another facility').click()
  await expect(page.getByRole('heading', { name: 'Referral out', exact: true })).toBeVisible()
  await page.getByLabel('Referral tracking number', { exact: true }).fill('RCC-2026-7788')
  await page.getByLabel('Receiving facility', { exact: true }).fill('Dammam Medical Complex')
  await expect(page.getByRole('group', { name: 'Ward', exact: true })).toHaveCount(0)

  await chip(page, 'Admission').click()
  await expect(page.getByRole('heading', { name: 'Referral out', exact: true })).toHaveCount(0)
  const ward = page.getByRole('group', { name: 'Ward', exact: true })
  await expect(ward).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Isolation/ })).toBeVisible()
  await ward.getByRole('button').first().click()

  // Both survive the round trip: the trajectory is a column like any other.
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(url)
  await expect(chip(page, 'Admission')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Ward', exact: true })).toBeVisible()
  // The referral number typed under the transfer pathway is still on the case, hidden and kept.
  await chip(page, 'Transfer to another facility').click()
  await expect(page.getByLabel('Referral tracking number', { exact: true })).toHaveValue('RCC-2026-7788')
  await expectNoSidewaysScroll(page)
})

/**
 * Decision E, the rule that makes changing your mind safe: a time entered under one pathway is
 * never dropped by moving to another. It leaves the block and is named on the "Also recorded"
 * line, and it survives a save and a reload.
 */
test('a time entered under another pathway is kept and said out loud', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.67' : '203.0.113.68')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await chip(page, 'Transfer to another facility').click()
  await recordJourney(page, ['Fax sent'])
  const stamp = await journeyOf(page)
    .locator('[data-journey-step="transferRequestedAt"]')
    .innerText()
  expect(stamp).toMatch(/Fax sent · \d\d\/\d\d \d\d:\d\d/)

  await chip(page, 'Admission').click()
  await expect(journeyOf(page).locator('[data-journey-step="transferRequestedAt"]')).toHaveCount(0)
  await expect(page.locator('[data-also-recorded]')).toContainText(
    /^Also recorded: Fax sent · \d\d\/\d\d \d\d:\d\d$/,
  )

  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(url)
  await expect(page.locator('[data-also-recorded]')).toContainText(/Fax sent/)

  // And moving back shows it in its own row again, with the value it had.
  await chip(page, 'Transfer to another facility').click()
  await expect(page.locator('[data-also-recorded]')).toHaveCount(0)
  await expect(journeyOf(page).locator('[data-journey-step="transferRequestedAt"]')).toContainText(
    /Fax sent · \d\d\/\d\d \d\d:\d\d/,
  )
})

/**
 * Decision D again, the other half: the Final disposition list is narrowed by the trajectory, and
 * "Show all outcomes" puts every one of the eight back, so no outcome is ever unreachable.
 */
test('the Final disposition list follows the trajectory, and Show all outcomes reveals the rest', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.69' : '203.0.113.70')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  const showAll = page.getByRole('button', { name: 'Show all outcomes', exact: true })
  const ALL = [
    'Admitted',
    'Discharged home',
    'Discharged DAMA',
    'Transferred to another facility',
    'Left without being seen',
    'Other',
    'Deceased',
    'Referred to UCC',
  ]
  // With no trajectory the list is all eight and there is nothing to reveal.
  expect(await outcomes(page)).toEqual(ALL)
  await expect(showAll).toHaveCount(0)

  await chip(page, 'Admission').click()
  expect(await outcomes(page)).toEqual(['Admitted', 'Other', 'Deceased'])
  await expect(showAll).toBeVisible()

  await chip(page, 'Transfer to another facility').click()
  expect(await outcomes(page)).toEqual(['Transferred to another facility', 'Other', 'Deceased'])

  await chip(page, 'Discharge').click()
  expect(await outcomes(page)).toEqual([
    'Discharged home',
    'Discharged DAMA',
    'Left without being seen',
    'Other',
    'Deceased',
    'Referred to UCC',
  ])

  // Every outcome stays reachable: one tap and the whole list is back, for the rest of the session.
  await showAll.click()
  expect(await outcomes(page)).toEqual(ALL)
  await expect(showAll).toHaveCount(0)
  await chip(page, 'Admission').click()
  expect(await outcomes(page)).toEqual(ALL)
  await expectNoSidewaysScroll(page)
})

/**
 * Decision C: once the outcome is chosen it governs, and what it owes is unchanged. A discharge
 * pathway that ends in an admission is asked for the admission order and the bed, and resolves.
 */
test('the outcome governs the sheet once it is chosen, whatever the trajectory said', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.71' : '203.0.113.72')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await chip(page, 'Discharge').click()
  expect(await shownSteps(page)).toEqual([...CORE])

  await page.getByRole('button', { name: 'Show all outcomes', exact: true }).click()
  await page.getByLabel('Final disposition', { exact: true }).selectOption('ADMITTED')
  // The outcome's own steps are back, tagged with what it cannot be closed without.
  expect(await shownSteps(page)).toContain('admOrderAt')
  await expect(page.locator('[data-resolve-missing]')).toHaveText(
    'Before resolving, enter: Triage, First physician contact, Disposition decided, ' +
      'Admission order written, Bed assigned, Left ED, Ward.',
  )

  await page.getByRole('group', { name: 'Ward', exact: true }).getByRole('button').first().click()
  await recordJourney(page, [
    'Triage',
    'First physician contact',
    'Disposition decided',
    'Admission order written',
    'Bed assigned',
    'Left ED',
  ])
  await expect(page.locator('[data-resolve-missing]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()

  // The summary sheet says both: where the case was going, and where it went.
  await page.getByRole('button', { name: 'Summary', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog.getByRole('rowheader', { name: 'Trajectory', exact: true })).toBeVisible()
  await expect(dialog).toContainText('Discharge')
  await expect(dialog).toContainText('Admitted')
})

/** A VIEWER reads the row and can change nothing on it, like every other control on the sheet. */
test('a viewer sees the trajectory and cannot change it', async ({ browser }) => {
  const editing = await browser.newContext()
  const reading = await browser.newContext()
  const nurse = await editing.newPage()
  const viewer = await reading.newPage()
  await fromClientIp(nurse, '203.0.113.73')
  await fromClientIp(viewer, '203.0.113.74')

  const taps = await signIn(nurse, E2E_USERS.navigator)
  const url = await openCase(nurse, uniqueMrn(), STAGE, REASON, taps)
  await chip(nurse, 'Admission').click()
  await nurse.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(nurse.getByText('Saved.', { exact: true })).toBeVisible()

  await signIn(viewer, E2E_USERS.viewer)
  await viewer.goto(url)
  await expect(chip(viewer, 'Admission')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(viewer, 'Admission')).toBeDisabled()
  await expect(chip(viewer, 'Discharge')).toBeDisabled()
  await expect(viewer.getByRole('button', { name: 'Show all outcomes', exact: true })).toHaveCount(0)

  await editing.close()
  await reading.close()
})
