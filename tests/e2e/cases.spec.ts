import { expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { CASE_URL, fromClientIp, openCase, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 2 slice through the browser. Mobile only: the editor is designed at 390 px and the
 * desktop rendering is the same single column, which the gate screenshots cover.
 */
test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'mobile', 'the case flow is checked at the phone size')
})
test.afterAll(async () => {
  await prisma.$disconnect()
})

/** The number of taps a nurse may spend opening a case (plan section 5.3 usability budget). */
const ACTION_BUDGET = 15

const STAGE = 'Admission process'
const REASON = 'No bed available on accepting ward'

/**
 * The team this suite retires. One stable name, upserted active at the start of the test and left
 * deactivated at the end, so a run adds at most this single row rather than one per run — and it
 * is a name no other spec or fixture uses.
 */
const RETIRED_TEAM = 'E2E Retired Team'

test('a navigator opens a case, adds an update and resolves it as discharged home', async ({ page }) => {
  await fromClientIp(page, '198.51.100.41')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()

  await openCase(page, mrn, STAGE, REASON, taps)

  // Signing in and opening the case together, counted in the test rather than estimated.
  expect(taps.count).toBeLessThanOrEqual(ACTION_BUDGET)
  console.log(`[cases] opening a case took ${taps.count} UI actions (budget ${ACTION_BUDGET})`)

  await expect(page.getByRole('heading', { name: `Case ${mrn}` })).toBeVisible()
  await expect(page.getByRole('button', { name: REASON })).toHaveAttribute('aria-pressed', 'true')

  // Append-only updates: Enter submits, the row lands with its author.
  await page.getByLabel('What changed?').fill('Bed coordinator says one hour')
  await page.getByLabel('What changed?').press('Enter')
  await expect(page.getByText('Bed coordinator says one hour')).toBeVisible()
  await expect(page.getByText(E2E_USERS.navigator.displayName, { exact: false }).first()).toBeVisible()
  await expect(page.getByText('MRN only, no names.')).toBeVisible()

  // Resolve: the button is dead until a disposition is chosen.
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeDisabled()
  await page.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await page.getByRole('button', { name: 'Mark resolved' }).click()

  await expect(page.getByRole('heading', { name: 'Resolved' })).toBeVisible()
  await expect(page.getByText('Resolved: Discharged home')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reopen case' })).toBeVisible()
})

test('an admission needs a ward before it can be resolved', async ({ page }) => {
  await fromClientIp(page, '198.51.100.42')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await page.getByLabel('Final disposition').selectOption('ADMITTED')
  await expect(page.getByRole('group', { name: 'Ward' })).toBeVisible()
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByText('Choose the ward.')).toBeVisible()

  await page.getByRole('group', { name: 'Ward' }).getByRole('button', { name: 'ICU' }).click()
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByText('Resolved: Admitted')).toBeVisible()
})

test('a team retired in Admin stays visible and removable on the case that carries it', async ({ page }) => {
  await fromClientIp(page, '198.51.100.50')
  const taps = await signIn(page, E2E_USERS.navigator)
  const team = await prisma.department.upsert({
    where: { name: RETIRED_TEAM },
    create: { name: RETIRED_TEAM, sortOrder: 900, active: true },
    update: { active: true },
  })

  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)
  await page.getByRole('group', { name: 'Departments' }).getByRole('button', { name: RETIRED_TEAM }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  // What Admin → Reference lists does. The case keeps the consult; the chip goes grey.
  await prisma.department.update({ where: { id: team.id }, data: { active: false } })
  await page.goto(url)
  const chip = page.getByRole('button', { name: `${RETIRED_TEAM} (retired)` })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  // The case still saves with it on — this is what a deactivation used to break ...
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  // ... and the chip is the control that clears it, after which it can never go back on.
  await chip.click()
  await expect(chip).toBeDisabled()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.goto(url)
  await expect(page.getByRole('button', { name: RETIRED_TEAM })).toHaveCount(0)
})

test('a second nurse saving first turns the stale save into "changed by", never a merge', async ({ browser }) => {
  const first = await browser.newContext()
  const second = await browser.newContext()
  const nurse = await first.newPage()
  const supervisor = await second.newPage()
  await fromClientIp(nurse, '198.51.100.43')
  await fromClientIp(supervisor, '198.51.100.44')

  const taps = await signIn(nurse, E2E_USERS.navigator)
  const url = await openCase(nurse, uniqueMrn(), STAGE, REASON, taps)

  // The supervisor opens the same case and saves, taking it to version 2.
  await signIn(supervisor, E2E_USERS.supervisor)
  await supervisor.goto(url)
  await supervisor.getByLabel('MRN (digits only)').fill('555001')
  await supervisor.getByRole('button', { name: 'Save changes' }).click()
  await expect(supervisor.getByRole('heading', { name: 'Case 555001' })).toBeVisible()

  // The nurse's tab still holds version 1.
  await nurse.getByLabel('MRN (digits only)').fill('555002')
  await nurse.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    nurse.getByText(`This case was changed by ${E2E_USERS.supervisor.displayName}`, { exact: false }),
  ).toBeVisible()
  await expect(nurse.getByText('Reload to continue.', { exact: false })).toBeVisible()
  await expect(nurse.getByRole('button', { name: 'Reload' })).toBeVisible()

  // Nothing was merged: the supervisor's value stands.
  await supervisor.reload()
  await expect(supervisor.getByLabel('MRN (digits only)')).toHaveValue('555001')

  await first.close()
  await second.close()
})

test('a supervisor voids a case with a reason and it becomes read-only', async ({ page }) => {
  await fromClientIp(page, '198.51.100.45')
  const taps = await signIn(page, E2E_USERS.supervisor)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await page.getByRole('button', { name: 'Void', exact: true }).click()
  // A reason is mandatory, and the commit needs two taps (the prototype's ConfirmButton).
  await expect(page.getByRole('button', { name: 'Void this case' })).toBeDisabled()
  await page.getByLabel('Why is this case voided?').fill('opened twice by mistake')
  await page.getByRole('button', { name: 'Void this case' }).click()
  await page.getByRole('button', { name: 'Tap again to void' }).click()

  await expect(page.getByText('This case was voided: opened twice by mistake', { exact: false })).toBeVisible()
  await expect(page.getByLabel('MRN (digits only)')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0)
})

test('a viewer sees the same editor read-only and cannot reach the new-case form', async ({ browser }) => {
  const editing = await browser.newContext()
  const reading = await browser.newContext()
  const nurse = await editing.newPage()
  const viewer = await reading.newPage()
  await fromClientIp(nurse, '198.51.100.46')
  await fromClientIp(viewer, '198.51.100.47')

  const taps = await signIn(nurse, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  const url = await openCase(nurse, mrn, STAGE, REASON, taps)

  await signIn(viewer, E2E_USERS.viewer)
  await expect(viewer.getByRole('link', { name: 'New case' })).toHaveCount(0)

  await viewer.goto(url)
  await expect(viewer).toHaveURL(CASE_URL)
  await expect(viewer.getByRole('heading', { name: `Case ${mrn}` })).toBeVisible()
  await expect(viewer.getByText('You have view-only access.', { exact: false })).toBeVisible()
  await expect(viewer.getByLabel('MRN (digits only)')).toBeDisabled()
  await expect(viewer.getByRole('button', { name: REASON })).toBeDisabled()
  await expect(viewer.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: 'Add' })).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: 'Void' })).toHaveCount(0)

  // Phase 7: the refusal is an HTTP 403 carrying app/forbidden.tsx, not a 200 that reads like one.
  const refused = await viewer.goto('/cases/new')
  expect(refused?.status()).toBe(403)
  await expect(viewer.getByRole('heading', { name: 'Not allowed' })).toBeVisible()

  await editing.close()
  await reading.close()
})

test('the referral sections appear with the reason that needs them', async ({ page }) => {
  await fromClientIp(page, '198.51.100.48')
  const taps = await signIn(page, E2E_USERS.navigator)
  await taps.clickLink(page, '+ New case')

  await page.getByRole('button', { name: 'Referral / consulted team' }).click()
  await expect(page.getByRole('heading', { name: 'Department / consulted team involved' })).toBeVisible()

  await page.getByRole('button', { name: 'Admission process' }).click()
  await page.getByRole('button', { name: 'Referred out: no bed in accepting department' }).click()
  await expect(page.getByRole('heading', { name: 'Referral out' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Admission times' })).toBeVisible()

  // Mobile-first means literally: with every section open the phone never scrolls sideways.
  // (Chrome answers horizontal overflow by shrinking the whole page, which is easy to miss.)
  await page.getByRole('button', { name: 'Add journey times (optional)' }).click()
  await expect(page.getByText('Medical admin on-call informed at')).toBeVisible()
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(width.inner).toBe(390)
  expect(width.scroll).toBeLessThanOrEqual(width.inner)
})

test('out-of-order times warn but never block the save', async ({ page }) => {
  await fromClientIp(page, '198.51.100.49')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  // Triage before registration: the prototype's "Check these times" panel, warn only.
  await page.getByLabel('Triage', { exact: true }).fill('2020-01-01T00:00')
  await expect(page.getByRole('heading', { name: 'Check these times' })).toBeVisible()
  await expect(page.getByText('Triage is before registration')).toBeVisible()
  await expect(page.getByText('You can still save.', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  // The out-of-order time was stored, and the panel is still there on a fresh load.
  await page.goto(url)
  await expect(page.getByText('Triage is before registration')).toBeVisible()
})
