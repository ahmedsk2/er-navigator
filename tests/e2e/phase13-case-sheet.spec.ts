import { expect, test, type Page } from '@playwright/test'
import {
  DISCHARGE_JOURNEY,
  TRANSFER_JOURNEY,
  fromClientIp,
  openCase,
  openMoreToRecord,
  recordJourney,
  signIn,
  uniqueMrn,
} from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 13: the case sheet redesigned by patient flow
 * (`docs/specs/phase13-case-sheet.md`; Ahmed, 12 September 2026).
 *
 * At both plan viewports, unlike `cases.spec.ts`, because what this phase changed is the shape of
 * the page and the shape is what differs between a phone and a laptop.
 */

const STAGE = 'Admission process'
const REASON = 'No bed available on accepting ward'
const TRANSFER_REASON = 'Waiting for RCC / transfer acceptance'

const CORE_STEPS = [
  'Triage',
  'Resus / exam room',
  'First physician contact',
  'Disposition decided',
  'Left ED',
  'Medical admin on-call informed at',
] as const
const ADMISSION_STEPS = ['Admission order written', 'Bed requested (fax sent)', 'Bed assigned'] as const
const TRANSFER_STEPS = ['Transfer requested', 'Accepted by facility', 'RCC / transport arrived'] as const

const journeyOf = (page: Page) => page.locator('#case-times')

/** Every step the block is showing, collapsed or open, in the order it draws them. */
async function shownSteps(page: Page): Promise<string[]> {
  return journeyOf(page).locator('[data-journey-step]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-journey-step') ?? ''),
  )
}

/** Chrome answers horizontal overflow by shrinking the page, which is easy to miss. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.inner)
}

/**
 * Decision B: the times are one block, near the top, on the new-case form as well — and decision
 * E: a blank case shows the six steps every patient has and nothing else.
 */
test('a new case opens on the journey block with the core steps alone', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.11' : '203.0.113.12')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/cases/new')

  const journey = journeyOf(page)
  await expect(journey.getByRole('heading', { name: 'Patient journey', exact: true })).toBeVisible()
  expect(await shownSteps(page)).toEqual([
    'triageAt',
    'roomAt',
    'physicianAt',
    'decisionAt',
    'departedAt',
    'medAdminInformedAt',
  ])
  for (const label of CORE_STEPS) {
    await expect(journey.getByLabel(label, { exact: true }), label).toBeVisible()
  }
  for (const label of [...ADMISSION_STEPS, ...TRANSFER_STEPS]) {
    await expect(journey.getByLabel(label, { exact: true }), label).toHaveCount(0)
  }
  // Nothing is required yet, so nothing is tagged.
  await expect(page.locator('[data-needed]')).toHaveCount(0)
  await expect(page.locator('[data-also-recorded]')).toHaveCount(0)

  // Decision C: the old "Add journey times (optional)" toggle is gone, and Triage is the step the
  // case is waiting for.
  await expect(page.getByRole('button', { name: /journey times/ })).toHaveCount(0)
  const next = page.locator('[data-next-step]')
  await expect(next).toHaveCount(1)
  await expect(next).toContainText('Triage')

  /**
   * P13.40. The shift is the one answer "More to record" held that a new case already carries:
   * `blankDraft` stamps it from the navigator's last shift and every save re-stamps `lastShift`,
   * so behind a closed section a wrong one perpetuates itself unseen while `byShift` and the
   * export read it. It is back in the identity block, as a chip row after "ED area", and the
   * section keeps its promise that nothing recorded is behind a tap.
   */
  const shift = page.getByRole('group', { name: 'Shift', exact: true })
  await expect(shift).toBeVisible()
  await expect(shift.getByRole('button')).toHaveText(['Morning', 'Evening', 'Night'])
  const area = (await page.getByRole('group', { name: 'ED area', exact: true }).boundingBox())!
  const shiftBox = (await shift.boundingBox())!
  expect(area.y).toBeLessThan(shiftBox.y)
  expect(shiftBox.y).toBeLessThan((await journey.boundingBox())!.y)
  await shift.getByRole('button', { name: 'Evening', exact: true }).click()
  await expect(shift.getByRole('button', { name: 'Evening', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Decision E: "More to record" starts closed, and its four answers with it.
  const more = page.getByRole('button', { name: 'More to record', exact: true })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Working diagnosis (optional)', { exact: true })).toHaveCount(0)
  await openMoreToRecord(page)
  await expect(page.getByLabel('Working diagnosis (optional)', { exact: true })).toBeVisible()
  // And the shift is not in there as well: it is recorded in one place.
  await expect(page.getByRole('combobox', { name: 'Shift', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Shift', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Pain management (Adaa KPI 8)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Case management', exact: true })).toBeVisible()

  // Decision D and the order of the sheet: the journey is above "Where is the delay?".
  const times = (await journey.boundingBox())!
  const delay = (await page.locator('#case-delay').boundingBox())!
  expect(times.y).toBeLessThan(delay.y)

  await expectNoSidewaysScroll(page)
})

/**
 * Decisions E and F: the stages imply which chain the case is on, a filled step collapses to one
 * line, the next empty one is the highlighted one, and Edit puts the box back.
 */
test('the stages add their steps, and a filled step collapses and reopens', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.13' : '203.0.113.14')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  // The admission stage is selected, so its three steps are there and the transfer's are not.
  const journey = journeyOf(page)
  for (const label of ADMISSION_STEPS) {
    await expect(journey.getByLabel(label, { exact: true }), label).toBeVisible()
  }
  await expect(journey.getByLabel('Transfer requested', { exact: true })).toHaveCount(0)

  // A reason that needs a referral number brings the transfer steps with it.
  await page
    .getByRole('group', { name: `${STAGE} reasons` })
    .getByRole('button', { name: TRANSFER_REASON, exact: true })
    .click()
  for (const label of TRANSFER_STEPS) {
    await expect(journey.getByLabel(label, { exact: true }), label).toBeVisible()
  }
  expect(await shownSteps(page)).toEqual([
    'triageAt',
    'roomAt',
    'physicianAt',
    'decisionAt',
    'admOrderAt',
    'bedRequestedAt',
    'bedAssignedAt',
    'transferRequestedAt',
    'transferAcceptedAt',
    'transportArrivedAt',
    'departedAt',
    'medAdminInformedAt',
  ])

  // Now on Triage: the row becomes one line with the time on it, and the highlight moves on.
  await page.getByRole('button', { name: 'Now — Triage', exact: true }).click()
  const triage = journey.locator('[data-journey-step="triageAt"]')
  await expect(triage).toContainText(/Triage · \d\d\/\d\d \d\d:\d\d/)
  await expect(journey.getByLabel('Triage', { exact: true })).toHaveCount(0)
  const next = page.locator('[data-next-step]')
  await expect(next).toHaveCount(1)
  await expect(next).toContainText('Resus / exam room')

  // Edit puts the box back, with the value it had.
  await triage.getByRole('button', { name: 'Edit — Triage', exact: true }).click()
  const box = journey.getByLabel('Triage', { exact: true })
  await expect(box).toBeVisible()
  await expect(box).not.toHaveValue('')

  // And with every step of both chains on the page, the phone still never scrolls sideways.
  await expectNoSidewaysScroll(page)

  // The strip still has its six chips in their Phase 11 order, and "Times" lands on the block.
  const strip = page.getByRole('navigation', { name: 'Jump to', exact: true })
  await expect(strip.getByRole('link')).toHaveText(['Delay', 'Teams', 'Times', 'Updates', 'Resolve'])
  await strip.getByRole('link', { name: 'Times', exact: true }).click()
  await expect(journey).toBeFocused()
})

/**
 * Decision C, both directions, on the outcome with the most to ask for: "Mark resolved" is dead
 * and says what is missing, and takes the case the moment nothing is.
 */
test('Mark resolved is blocked with the missing list, then allowed', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.15' : '203.0.113.16')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, TRANSFER_REASON, taps)

  const resolve = page.getByRole('button', { name: 'Mark resolved', exact: true })
  const missing = page.locator('[data-resolve-missing]')
  await expect(resolve).toBeDisabled()
  await expect(missing).toHaveCount(0)

  await page.getByLabel('Final disposition').selectOption('TRANSFERRED')
  await expect(resolve).toBeDisabled()
  await expect(missing).toHaveText(
    'Before resolving, enter: Triage, First physician contact, Disposition decided, Transfer requested, ' +
      'Accepted by facility, Left ED, Referral tracking number, Receiving facility.',
  )
  // Each required step says so on its own row.
  await expect(journeyOf(page).locator('[data-needed]')).toHaveCount(6)

  await page.getByLabel('Referral tracking number', { exact: true }).fill('RCC-2026-9001')
  await page.getByLabel('Receiving facility', { exact: true }).fill('Dammam Medical Complex')
  await expect(missing).toHaveText(
    'Before resolving, enter: Triage, First physician contact, Disposition decided, Transfer requested, ' +
      'Accepted by facility, Left ED.',
  )

  await recordJourney(page, TRANSFER_JOURNEY)
  await expect(missing).toHaveCount(0)
  await expect(journeyOf(page).locator('[data-needed]')).toHaveCount(0)
  await expect(resolve).toBeEnabled()
  await resolve.click()
  await expect(page.getByText('Resolved: Transferred to another facility')).toBeVisible()

  // The resolve block shows the departure read-only, and the input for it is in the journey.
  await expect(page.getByLabel('Left ED at (defaults to now)')).toHaveCount(0)
  const leftEd = page.locator('[data-left-ed]')
  await expect(leftEd).toContainText(/Left ED\s*\d\d\/\d\d \d\d:\d\d/)
  await expect(leftEd.getByRole('button', { name: 'Set Left ED to now', exact: true })).toBeVisible()
})

/**
 * Decisions E and G: a patient who left without being seen has no physician contact and no
 * disposition decision, so neither is shown — and a physician time recorded before the outcome
 * was known is still on the case, and still said out loud.
 */
test('LWBS hides the physician and the decision, and still shows what was recorded', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.17' : '203.0.113.18')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await recordJourney(page, ['Triage', 'First physician contact'])
  await page.getByLabel('Final disposition').selectOption('LEFT_WITHOUT_BEING_SEEN')

  const journey = journeyOf(page)
  expect(await shownSteps(page)).toEqual(['triageAt', 'roomAt', 'departedAt', 'medAdminInformedAt'])
  await expect(journey.getByLabel('First physician contact', { exact: true })).toHaveCount(0)
  await expect(journey.getByLabel('Disposition decided', { exact: true })).toHaveCount(0)
  await expect(journey.locator('[data-journey-step="physicianAt"]')).toHaveCount(0)

  // Nothing was dropped: the recorded physician contact is on the "Also recorded" line.
  await expect(page.locator('[data-also-recorded]')).toContainText(
    /^Also recorded: First physician contact · \d\d\/\d\d \d\d:\d\d$/,
  )

  // The departure is all it is asked for.
  await expect(page.locator('[data-resolve-missing]')).toHaveText('Before resolving, enter: Left ED.')
  await recordJourney(page, ['Left ED'])
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
  await expect(page.getByText('Resolved: Left without being seen')).toBeVisible()
})

/**
 * P13.41, the reopen trap. Decision C is enforced at "Mark resolved" and there is no migration, so
 * a case resolved before the rule — or seeded without the times its outcome needs — reopened in
 * one tap and then could not be closed again until they were entered, with nothing on the screen
 * having said so. "Reopen case" now asks first, in the app's two-tap pattern, and the sentence
 * above it names exactly what the case will owe.
 */
test('Reopen case says what the case will owe, and one tap alone does not reopen it', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.21' : '203.0.113.22')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await page.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await recordJourney(page, DISCHARGE_JOURNEY)
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()

  // Nothing is missing on a case resolved under the rule, so the confirmation is a plain one.
  const needs = page.locator('[data-reopen-needs]')
  await expect(needs).toHaveText(
    'Reopening puts this case back on the board. Everything it needs to be resolved again is already recorded.',
  )

  /**
   * Now the case a nurse actually meets. "Save changes" runs the draft rules and not the resolve
   * rules — a case opens on an MRN, a time and a reason, and every journey time may be blank — so
   * clearing Triage on a resolved case leaves exactly the row a pre-Phase-13 resolve left behind.
   */
  const journey = journeyOf(page)
  await journey
    .locator('[data-journey-step="triageAt"]')
    .getByRole('button', { name: 'Edit — Triage', exact: true })
    .click()
  await journey.getByLabel('Triage', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await expect(needs).toHaveText(
    'Reopening puts this case back on the board. Before it can be resolved again, enter: Triage.',
  )

  // Cancel: one tap arms the button and does nothing else, and the arming lapses on its own.
  const reopen = page.getByRole('button', { name: 'Reopen case', exact: true })
  await reopen.click()
  await expect(page.getByRole('button', { name: 'Tap again to reopen', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark resolved', exact: true })).toHaveCount(0)
  await expect(reopen).toBeVisible({ timeout: 6_000 })
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()

  // Confirm: the second tap inside the window reopens it, and the case owes what the sentence said.
  await reopen.click()
  await page.getByRole('button', { name: 'Tap again to reopen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Resolve case', exact: true })).toBeVisible()
  await expect(needs).toHaveCount(0)
  await expect(page.locator('[data-resolve-missing]')).toHaveText('Before resolving, enter: Triage.')
  await expect(page.getByRole('button', { name: 'Mark resolved', exact: true })).toBeDisabled()
})

/**
 * Decision E: "More to record" is closed on a case that carries none of its answers and open on
 * one that does, so nothing already recorded is ever behind a tap.
 *
 * The answer it records is the working diagnosis and not the payer, deliberately: the dashboard
 * suite isolates its own figures with "every payer at once", on the grounds that nothing else
 * resolves a case carrying one, and a resolved case with a payer here would land in the Adaa
 * KPI 5 denominator.
 */
test('More to record opens itself on a case that already carries one of its answers', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.19' : '203.0.113.20')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  const more = page.getByRole('button', { name: 'More to record', exact: true })
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  await openMoreToRecord(page)
  await page.getByLabel('Working diagnosis (optional)', { exact: true }).fill('Chest pain, for admission')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  await page.goto(url)
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByLabel('Working diagnosis (optional)', { exact: true })).toHaveValue(
    'Chest pain, for admission',
  )

  // A discharge home asks for its three times and the departure, and takes the case.
  await page.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await recordJourney(page, DISCHARGE_JOURNEY)
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
  await expect(page.getByText('Resolved: Discharged home')).toBeVisible()
})
