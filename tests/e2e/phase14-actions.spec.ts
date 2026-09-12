import { expect, test, type Page } from '@playwright/test'
import { CASE_URL, fromClientIp, openCase, recordJourney, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 14 (docs/specs/phase14-actions-and-escalation.md; Ahmed, 12 September 2026, after working
 * the Phase 13 sheet): the Timeline and the Updates section are off the case page, and in their
 * place, in the Resolve block above "Final disposition", are the two answers he asked for — what
 * was done about the delay, and whether it went to the medical director.
 *
 * Both viewports, because the case page is a phone page first and the two controls are the last
 * thing added to a sheet that already fits 390 px.
 */
const STAGE = 'Admission process'
const REASON = 'No bed available on accepting ward'

const ACTION_LABEL = 'What was done to solve the delay'
const ESCALATION_GROUP = 'Escalated to medical director'

const resolveSection = (page: Page) => page.locator('#case-resolve')
const actionBox = (page: Page) => page.getByLabel(ACTION_LABEL, { exact: true })
const escalation = (page: Page) => page.getByRole('group', { name: ESCALATION_GROUP, exact: true })

/** The whole document is never wider than the window: the Phase 11 rule, re-checked here. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1)
}

/**
 * Decisions A and B. Neither section is on the page at all — not collapsed, not empty — and the
 * strip that used to jump to one of them has five chips.
 */
test('the timeline and the updates section are off the case page', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.41' : '203.0.113.42')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  // The timeline: no heading, no list, no step.
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-timeline]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-step]')).toHaveCount(0)

  // The updates: no section, no composer, no action-tag chips, no list.
  await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toHaveCount(0)
  await expect(page.locator('#case-updates')).toHaveCount(0)
  await expect(page.getByLabel('What changed?', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Action taken (optional)', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)

  // The strip keeps its Phase 11 order with one chip gone, and Resolve still lands where it says.
  const strip = page.getByRole('navigation', { name: 'Jump to', exact: true })
  await expect(strip.getByRole('link')).toHaveText(['Delay', 'Teams', 'Times', 'Resolve'])
  await strip.getByRole('link', { name: 'Resolve', exact: true }).click()
  await expect(resolveSection(page)).toBeFocused()
  await expect(page).toHaveURL(url)

  // A reload says the same thing: this is the page, not a hydration artefact.
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toHaveCount(0)
  await expectNoSidewaysScroll(page)
})

/**
 * Decision C, and the mirroring rule behind it (decision D). The two inputs are in the Resolve
 * block above the disposition, they survive a save and a reload, and the text lands in the case's
 * history — which is what the summary sheet reads and what keeps the deck and the board honest.
 */
test('the two inputs sit above Final disposition, save, and mirror into the history', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.43' : '203.0.113.44')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  const url = await openCase(page, mrn, STAGE, REASON, taps)

  const resolve = resolveSection(page)
  await expect(actionBox(page)).toBeVisible()
  await expect(escalation(page)).toBeVisible()

  // Inside the Resolve section, and both above the disposition select.
  await expect(resolve.getByLabel(ACTION_LABEL, { exact: true })).toHaveCount(1)
  const order = await resolve.evaluate((section) => {
    const box = section.querySelector('input[maxlength]')
    const group = section.querySelector('[role="group"]')
    const select = section.querySelector('select')
    if (!box || !group || !select) return null
    return {
      boxFirst: box.compareDocumentPosition(select) === Node.DOCUMENT_POSITION_FOLLOWING,
      groupFirst: group.compareDocumentPosition(select) === Node.DOCUMENT_POSITION_FOLLOWING,
    }
  })
  expect(order).toEqual({ boxFirst: true, groupFirst: true })

  // The box carries its own cap and the standing MRN-only hint, like every other free-text box.
  await expect(actionBox(page)).toHaveAttribute('maxlength', '1000')
  await expect(
    page.locator('[data-mrn-hint]').filter({ hasText: 'MRN only, no names.' }).first(),
  ).toBeVisible()

  const ACTION = 'Bed manager called twice; ICU holding a bed for 14:00'
  await actionBox(page).fill(ACTION)
  await escalation(page).getByRole('button', { name: 'Yes', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  // Read back from a fresh load: a chip that looks pressed and was never stored is the failure.
  await page.goto(url)
  await expect(actionBox(page)).toHaveValue(ACTION)
  await expect(escalation(page).getByRole('button', { name: 'Yes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expectNoSidewaysScroll(page)

  // The save appended one update carrying the same text, tagged by the escalation, and the summary
  // sheet — where the update list still lives — is where a nurse sees it.
  await page.getByRole('button', { name: 'Summary', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(ACTION)
  await expect(dialog).toContainText('Leadership escalation')
  await expect(dialog.getByRole('rowheader', { name: 'Updates', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  // Tapping the chosen chip again clears the answer back to unset, and that saves too.
  await escalation(page).getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(escalation(page).getByRole('button', { name: 'Yes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.goto(url)
  for (const answer of ['Yes', 'No']) {
    await expect(escalation(page).getByRole('button', { name: answer, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }
})

/** Decision C's second half: both are editable after the case has been resolved, too. */
test('both stay editable on a resolved case', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.45' : '203.0.113.46')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), 'Discharge process', 'Awaiting pharmacy', taps)

  await page.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await recordJourney(page, ['Triage', 'First physician contact', 'Disposition decided', 'Left ED'])
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()

  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible()
  await expect(actionBox(page)).toBeEnabled()
  const AFTER = 'Pharmacy delivered at 13:40; patient walked out with a relative'
  await actionBox(page).fill(AFTER)
  await escalation(page).getByRole('button', { name: 'No', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  await page.goto(url)
  await expect(actionBox(page)).toHaveValue(AFTER)
  await expect(escalation(page).getByRole('button', { name: 'No', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

/** A new case has no Resolve section, so it has neither control, exactly as it has no Save. */
test('a new case offers neither, because it has no Resolve block yet', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '203.0.113.47' : '203.0.113.48')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/cases/new')
  await expect(page.getByRole('heading', { name: 'New case', exact: true })).toBeVisible()
  await expect(actionBox(page)).toHaveCount(0)
  await expect(escalation(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(CASE_URL)
})

/** A VIEWER reads the pair and can change neither: the same screen, every control disabled. */
test('a viewer sees the two answers and cannot touch them', async ({ browser }) => {
  const editing = await browser.newContext()
  const reading = await browser.newContext()
  const nurse = await editing.newPage()
  const viewer = await reading.newPage()
  await fromClientIp(nurse, '203.0.113.49')
  await fromClientIp(viewer, '203.0.113.50')

  const taps = await signIn(nurse, E2E_USERS.navigator)
  const url = await openCase(nurse, uniqueMrn(), STAGE, REASON, taps)
  await actionBox(nurse).fill('Escalated to the medical director on call')
  await escalation(nurse).getByRole('button', { name: 'Yes', exact: true }).click()
  await nurse.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(nurse.getByText('Saved.', { exact: true })).toBeVisible()

  await signIn(viewer, E2E_USERS.viewer)
  await viewer.goto(url)
  await expect(actionBox(viewer)).toHaveValue('Escalated to the medical director on call')
  await expect(actionBox(viewer)).toBeDisabled()
  await expect(escalation(viewer).getByRole('button', { name: 'Yes', exact: true })).toBeDisabled()
  await expect(viewer.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0)

  await editing.close()
  await reading.close()
})
