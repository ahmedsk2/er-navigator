import ExcelJS from 'exceljs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { riyadhDateKey } from '../../src/lib/export/range'
import { CASES_HEADER } from '../../src/lib/export/rows'
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

/** One of the six seeded ED areas (prisma/seed.ts, src/lib/domain/taxonomy.ts). */
const AREA_NAME = 'Rapid assessment zone'
const AREA_CODE = 'RAZ'

/** Phase 10: the working diagnosis and the payer (src/lib/domain/taxonomy.ts PAYER_LABELS). */
const DIAGNOSIS_LABEL = 'Working diagnosis (optional)'
const DIAGNOSIS = 'Chest pain, for admission'
const PAYER_LABEL = 'Insured'
/** The other labelled box with a microphone beside it (the Resolve section). */
const NOTE_LABEL = 'Resolution note (optional)'

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

test('a department chip toggled off and on again keeps that team times', async ({ page }) => {
  await fromClientIp(page, '198.51.100.52')
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  const chip = page.getByRole('group', { name: 'Departments' }).getByRole('button', { name: 'ICU', exact: true })
  await chip.click()
  await page.getByLabel('Consulted at', { exact: true }).fill('2026-09-09T14:10')
  await page.getByLabel('Seen patient at', { exact: true }).fill('2026-09-09T15:40')

  // A thumb catching the chip while scrolling, then putting it back (prototype: the consult map
  // a deselect never touches).
  await chip.click()
  await expect(page.getByLabel('Consulted at', { exact: true })).toHaveCount(0)
  await chip.click()
  await expect(page.getByLabel('Consulted at', { exact: true })).toHaveValue('2026-09-09T14:10')
  await expect(page.getByLabel('Seen patient at', { exact: true })).toHaveValue('2026-09-09T15:40')

  // And what the round trip stores is the restored pair, not two nulls.
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Consulted at', { exact: true })).toHaveValue('2026-09-09T14:10')
})

test('a save that never reaches the server says so, and says nothing was saved', async ({ page }) => {
  await fromClientIp(page, '198.51.100.51')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  // The server action posts back to the case's own URL; drop it the way ward wifi does.
  await page.route(url, async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed')
    else await route.fallback()
  })

  await page.getByLabel('MRN (digits only)').fill('444001')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const alert = page.locator('[data-unreachable]')
  await expect(alert).toHaveRole('alert')
  await expect(alert).toHaveText('Could not reach the server. Nothing was saved. Check the connection and try again.')
  // `exact` matters: getByText is case-insensitive and this alert itself says "nothing was saved".
  await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0)
  // The message is persistent: the button comes back but the warning stays put.
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  await expect(alert).toBeVisible()

  // And it told the truth — nothing was written.
  await page.unroute(url)
  await page.goto(url)
  await expect(page.getByLabel('MRN (digits only)')).not.toHaveValue('444001')
  await expect(page.locator('[data-unreachable]')).toHaveCount(0)
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

/**
 * Phase 8, Slice D. A navigator sets the CTAS level and the ED area on a new case; the board row
 * shows them beside the MRN, and the workbook's Cases sheet carries them in their own columns.
 *
 * The export half runs the reader in Node rather than in the page: the route serves an .xlsx,
 * which the browser cannot assert on, and exceljs is already a dependency of the writer.
 */
test('CTAS and the ED area reach the board row and the export', async ({ page }) => {
  await fromClientIp(page, '198.51.100.53')
  // A supervisor, not a navigator: the same case screen, and `export.xlsx` as well (a navigator
  // is refused it — tests/e2e/export.spec.ts).
  const taps = await signIn(page, E2E_USERS.supervisor)
  const mrn = uniqueMrn()
  const url = await openCase(page, mrn, STAGE, REASON, taps)

  await page.getByRole('group', { name: 'CTAS' }).getByRole('button', { name: '3', exact: true }).click()
  await page.getByRole('group', { name: 'ED area' }).getByRole('button', { name: AREA_NAME }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  // Both chips come back pressed on a fresh load, so the values really were stored.
  await page.goto(url)
  await expect(
    page.getByRole('group', { name: 'CTAS' }).getByRole('button', { name: '3', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: 'ED area' }).getByRole('button', { name: AREA_NAME }),
  ).toHaveAttribute('aria-pressed', 'true')

  // The board row carries both as small chips after the MRN.
  await page.goto('/')
  const boardRow = page.locator(`a[data-mrn="${mrn}"]`)
  await expect(boardRow).toBeVisible()
  await expect(boardRow.locator('[data-chip="CTAS 3"]')).toBeVisible()
  await expect(boardRow.locator(`[data-chip="${AREA_CODE}"]`)).toBeVisible()

  // And the workbook's Cases sheet has them in their own columns, after Shift. The window is
  // yesterday to today in Riyadh, because `blankDraft` registers a new case six hours ago and a
  // run just after midnight would otherwise miss its own row.
  const today = riyadhDateKey(new Date())
  const yesterday = riyadhDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const response = await page.request.get(`/api/export.xlsx?from=${yesterday}&to=${today}&status=all`)
  expect(response.status()).toBe(200)
  const book = new ExcelJS.Workbook()
  // exceljs declares its own `Buffer` interface, which Node's does not structurally satisfy
  // (the same cast tests/db/export.test.ts makes).
  await book.xlsx.load(Buffer.from(await response.body()) as unknown as ExcelJS.Buffer)
  const sheet = book.getWorksheet('Cases')!

  // `getRow(1).values` is 1-based and sparse, so index 0 is empty and a header's index is its
  // column number.
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).map((v) => String(v ?? ''))
  expect(header.slice(1)).toEqual(CASES_HEADER)

  const cells: string[] = []
  sheet.eachRow((row, index) => {
    if (index > 1 && String(row.getCell(header.indexOf('MRN')).value ?? '') === mrn) {
      cells.push(String(row.getCell(header.indexOf('CTAS')).value ?? ''))
      cells.push(String(row.getCell(header.indexOf('ED area')).value ?? ''))
    }
  })
  expect(cells, `the workbook has one row for MRN ${mrn}`).toEqual(['3', AREA_NAME])
})

/**
 * Phase 10, Slice 10A. Ahmed's second and sixth requests of 10 September: a one-line working
 * diagnosis beside CTAS, and who pays for the visit. The same journey as the Phase 8 test above,
 * because they are the same kind of field - set on the case screen, shown on the board row, and
 * carried into the workbook's Cases sheet.
 *
 * The dictation button is checked here too, and the check branches: the Web Speech API is a
 * browser fact, and Playwright's Chromium is not guaranteed to expose it. Where the API exists
 * the microphone must be there; where it does not, nothing may render - which is exactly what an
 * iPhone gets, and the keyboard's own microphone is what a nurse uses there.
 */
test('the working diagnosis and the payer reach the board row and the export', async ({ page }) => {
  await fromClientIp(page, '198.51.100.58')
  // A supervisor, for `export.xlsx`, as the Phase 8 test above.
  const taps = await signIn(page, E2E_USERS.supervisor)
  const mrn = uniqueMrn()
  const url = await openCase(page, mrn, STAGE, REASON, taps)

  await page.getByLabel(DIAGNOSIS_LABEL, { exact: true }).fill(DIAGNOSIS)
  await page.getByRole('group', { name: 'Payer' }).getByRole('button', { name: PAYER_LABEL }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  // Both come back on a fresh load, so the values really were stored.
  await page.goto(url)
  const diagnosis = page.getByLabel(DIAGNOSIS_LABEL, { exact: true })
  await expect(diagnosis).toHaveValue(DIAGNOSIS)
  await expect(
    page.getByRole('group', { name: 'Payer' }).getByRole('button', { name: PAYER_LABEL }),
  ).toHaveAttribute('aria-pressed', 'true')

  // The microphone: present exactly where the browser offers the API, absent everywhere else.
  const speechApi = await page.evaluate(
    () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
  )
  const dictate = page.getByRole('button', { name: 'Dictate' })
  if (speechApi) {
    await expect(dictate.first()).toBeVisible()
    await expect(dictate.first()).toHaveAttribute('aria-pressed', 'false')
  } else {
    await expect(dictate).toHaveCount(0)
  }
  console.log(`[cases] the Web Speech API is ${speechApi ? 'present' : 'absent'} in this browser`)

  // The box is named by its label and nothing else. The microphone shares the row with it, and
  // a <label> wrapped round the pair made the button part of the input's name ("Working
  // diagnosis (optional) Dictate"); the resolution note had the same row. Asserted after the
  // branch above, because the button only renders once the page has hydrated — before that the
  // name is right by accident.
  await expect(diagnosis).toHaveAccessibleName(DIAGNOSIS_LABEL)
  await expect(page.getByLabel(NOTE_LABEL, { exact: true })).toHaveAccessibleName(NOTE_LABEL)

  // The board row: the payer as a chip after the MRN, the diagnosis as its own line.
  await page.goto('/')
  const boardRow = page.locator(`a[data-mrn="${mrn}"]`)
  await expect(boardRow).toBeVisible()
  await expect(boardRow.locator(`[data-chip="${PAYER_LABEL}"]`)).toBeVisible()
  await expect(boardRow.locator('[data-diagnosis]')).toHaveText(DIAGNOSIS)

  // And the workbook's Cases sheet has both in their own columns, after "ED area".
  const today = riyadhDateKey(new Date())
  const yesterday = riyadhDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const response = await page.request.get(`/api/export.xlsx?from=${yesterday}&to=${today}&status=all`)
  expect(response.status()).toBe(200)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(Buffer.from(await response.body()) as unknown as ExcelJS.Buffer)
  const sheet = book.getWorksheet('Cases')!

  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).map((v) => String(v ?? ''))
  expect(header.slice(1)).toEqual(CASES_HEADER)

  const cells: string[] = []
  sheet.eachRow((row, index) => {
    if (index > 1 && String(row.getCell(header.indexOf('MRN')).value ?? '') === mrn) {
      cells.push(String(row.getCell(header.indexOf('Working diagnosis')).value ?? ''))
      cells.push(String(row.getCell(header.indexOf('Payer')).value ?? ''))
    }
  })
  expect(cells, `the workbook has one row for MRN ${mrn}`).toEqual([DIAGNOSIS, PAYER_LABEL])
})

/**
 * A stand-in for the Web Speech API, installed before the page's own scripts run. Real
 * recognition needs a microphone and, in Chrome, Google's servers; neither is here, and what is
 * under test is ours — what the button and the box do with what the recogniser reports. Each
 * `start()` reports the next outcome a moment later, as the real one does, and then the session
 * ends; the last outcome repeats.
 */
type Heard = { error: string } | { transcript: string }
async function fakeRecogniser(page: Page, outcomes: Heard[]): Promise<void> {
  await page.addInitScript((sequence: Heard[]) => {
    let started = 0
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      onend: (() => void) | null = null
      start(): void {
        const heard = sequence[Math.min(started, sequence.length - 1)]!
        started += 1
        setTimeout(() => {
          if ('error' in heard) this.onerror?.({ error: heard.error })
          else {
            const result = { isFinal: true, length: 1, 0: { transcript: heard.transcript } }
            this.onresult?.({ resultIndex: 0, results: { length: 1, 0: result } })
          }
          this.onend?.()
        }, 50)
      }
      stop(): void {}
      abort(): void {}
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
  }, outcomes)
}

/** What the stand-in hears when it hears anything. */
const HEARD = 'for admission'

/**
 * The microphone beside one box. Every box on the case page that has one calls it "Dictate", so
 * it is found through its box: the innermost element holding both the box and a microphone.
 */
function micBeside(page: Page, box: Locator): Locator {
  return page
    .locator('div')
    .filter({ has: box })
    .filter({ has: page.locator('[data-dictate]') })
    .last()
    .locator('[data-dictate]')
}

/**
 * Phase 10, the review of Slice 10A. A nurse who once refused the browser's microphone prompt —
 * or whose phone refuses it for her — tapped the button and watched it flip to "Stop dictating"
 * and back with no word of why. The recogniser's error code now becomes one line under the row.
 */
test('a blocked microphone says why, and the button goes back to Dictate', async ({ page }) => {
  await fromClientIp(page, '198.51.100.186')
  await fakeRecogniser(page, [{ error: 'not-allowed' }])
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  const diagnosis = page.getByLabel(DIAGNOSIS_LABEL, { exact: true })
  const mic = micBeside(page, diagnosis)
  await mic.click()

  const line = page.locator('[data-dictate-status]')
  await expect(line).toHaveText(
    'The browser has blocked the microphone for this site. Allow it in the site settings, or type instead.',
  )
  await expect(line).toHaveAttribute('role', 'status')
  await expect(mic).toHaveAccessibleName('Dictate')
  await expect(mic).toHaveAttribute('aria-pressed', 'false')
  // With the microphone certainly on the page, the box is still named by its label alone.
  await expect(diagnosis).toHaveAccessibleName(DIAGNOSIS_LABEL)
})

/**
 * The same stand-in, hearing words on the second try. The line a failed session left goes as
 * soon as the nurse tries again, and what the recogniser hears joins what she has typed, with one
 * space between.
 */
test('dictated words are appended to the box, and trying again clears the last line', async ({ page }) => {
  await fromClientIp(page, '198.51.100.187')
  await fakeRecogniser(page, [{ error: 'no-speech' }, { transcript: HEARD }])
  const taps = await signIn(page, E2E_USERS.navigator)
  await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  const diagnosis = page.getByLabel(DIAGNOSIS_LABEL, { exact: true })
  const mic = micBeside(page, diagnosis)
  await diagnosis.fill('Chest pain')
  await mic.click()
  const line = page.locator('[data-dictate-status]')
  await expect(line).toHaveText('Nothing was heard. Tap the microphone and speak again.')

  await mic.click()
  await expect(diagnosis).toHaveValue(`Chest pain ${HEARD}`)
  await expect(line).toHaveCount(0)
  await expect(mic).toHaveAccessibleName('Dictate')
})

/**
 * Phase 10, Slice 10C. The case summary: the panel a nurse opens to answer "what is happening
 * with 851557?" and the block of text she pastes into the handover message.
 *
 * The clipboard is read back rather than trusted, because the whole point of the Copy button is
 * what lands on the clipboard — and because the assertion that matters is a negative one: the
 * update text the nurse typed on this very case must not be in it.
 */
test('the case summary opens over the case, names it, and copies itself as text', async ({ page }) => {
  await fromClientIp(page, '198.51.100.59')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  await openCase(page, mrn, STAGE, REASON, taps)

  // A note with a name in it: exactly the free text a summary must never carry.
  const UPDATE_TEXT = 'Ward says Mrs Haddad is ahead of us in the queue'
  await page.getByLabel('What changed?').fill(UPDATE_TEXT)
  await page.getByLabel('What changed?').press('Enter')
  await expect(page.getByText(UPDATE_TEXT)).toBeVisible()

  await page.getByRole('button', { name: 'Summary', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(mrn)
  await expect(dialog).toContainText(REASON)
  await expect(dialog).toContainText('Registration')
  // The panel is a reading of the case, not a second editor: the note is counted, never quoted.
  await expect(dialog).toContainText('Updates')
  await expect(dialog).not.toContainText('Mrs Haddad')

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(dialog.getByText('Copied.', { exact: true })).toBeVisible()

  // Windows hands `\n` back as `\r\n` through the OS clipboard, so the line breaks are normalised
  // before the lines are read. What is asserted is the text, not the platform's newline.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
  expect(copied.split('\n')[0]).toBe(`Case summary — MRN ${mrn}`)
  expect(copied).toContain(`* ${REASON} (Admission process)`)
  expect(copied).toContain('Time sequence:')
  expect(copied).toContain('Registration')
  expect(copied).not.toContain('Mrs Haddad')

  // Escape leaves the panel and puts the keyboard back on the button that opened it.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeFocused()
})

/**
 * Phase 8, Slice E. The case's time sequence, read-only, after the updates — the weekly deck's
 * per-case slide generated — and the same sequence in one compact line under the case's row on
 * the handover sheet.
 *
 * The two times are written in the browser's own zone, because that is what a `datetime-local`
 * input reads and writes; the interval between them is therefore exact to the minute, while the
 * one from the registration (which carries seconds) is only asserted in shape.
 */
test('the timeline lists the recorded steps in order with the interval between them', async ({ page }) => {
  await fromClientIp(page, '198.51.100.54')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  const url = await openCase(page, mrn, STAGE, REASON, taps)

  /** "YYYY-MM-DDTHH:mm" `hours` ago in the browser's zone, exactly as `toLocalInput` builds it. */
  const localInput = (hours: number) =>
    page.evaluate((h) => {
      const d = new Date(Date.now() - h * 3_600_000)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }, hours)

  // A new case registers six hours ago, so five and four and a half hours ago are both after it.
  await page.getByLabel('Triage', { exact: true }).fill(await localInput(5))
  await page.getByLabel('First physician contact', { exact: true }).fill(await localInput(4.5))
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible()

  // Registration first, then the two times, in the order they happened and not the order typed.
  const steps = page.locator('[data-timeline] [data-timeline-step]')
  expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-timeline-step')))).toEqual([
    'registrationAt',
    'triageAt',
    'physicianAt',
  ])
  await expect(steps.nth(1)).toContainText('Triage')
  await expect(steps.nth(2)).toContainText('First physician contact')

  // The first step has no interval; the second's is measured from a registration that carries
  // seconds, so only its shape is asserted; the third's is exactly the half hour that was typed.
  await expect(steps.nth(0)).not.toContainText('+')
  await expect(steps.nth(1)).toContainText(/\+\d+h \d\dm/)
  await expect(steps.nth(2)).toContainText('+0h 30m')

  // And the same sequence on the handover sheet, which is what a shift change actually carries.
  await page.goto('/')
  await expect(page.locator(`a[data-mrn="${mrn}"]`)).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  const sheetRow = page.locator(`[data-timeline-row="${mrn}"]`)
  await expect(sheetRow).toBeVisible()
  await expect(sheetRow).toContainText('Registration')
  await expect(sheetRow).toContainText('Triage')
  await expect(sheetRow).toContainText('First physician contact (+0h 30m)')
  await page.emulateMedia({ media: 'screen' })
})

/**
 * Phase 8b, decisions F and E (docs/specs/phase8b-decisions.md). The pain-management block is
 * Adaa KPI 8, so it is on every case; the pethidine row is one control over two columns, which is
 * what makes the pair zod refuses unreachable; and MRI is the imaging type the app could not
 * record before. Everything is read back from a fresh load, because a chip that looks pressed and
 * was never stored is exactly the failure this slice exists to prevent.
 */
test('the pain-management block, an MRI row and a Deceased disposition round-trip', async ({ page }) => {
  await fromClientIp(page, '198.51.100.55')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  // Opened on the Investigations stage, so the imaging block is there on the first paint and is
  // still there after a reload: the editor derives its stage chips from the reasons it stored.
  const url = await openCase(page, mrn, 'Investigations', 'Imaging: report delay', taps)

  const painkiller = page.getByRole('group', { name: 'Painkiller prescribed' })
  await expect(page.getByRole('heading', { name: 'Pain management (Adaa KPI 8)' })).toBeVisible()

  // Nothing under "Yes" is offered until the answer is Yes.
  await expect(page.getByRole('group', { name: 'Pethidine' })).toHaveCount(0)
  await painkiller.getByRole('button', { name: 'Yes', exact: true }).click()
  await page.getByRole('group', { name: 'Pethidine' }).getByRole('button', { name: '100 mg' }).click()
  await page.getByLabel('Painkiller given at', { exact: true }).fill('2026-09-09T14:20')
  await page
    .getByRole('group', { name: 'Sickle-cell treatment identified' })
    .getByRole('button', { name: 'No', exact: true })
    .click()

  // An MRI row, with the CT steps.
  const types = page.getByRole('group', { name: 'Investigation types' })
  await types.getByRole('button', { name: 'MRI' }).click()
  await expect(page.getByLabel('Preliminary report', { exact: true })).toBeVisible()
  await page.getByLabel('Ordered', { exact: true }).fill('2026-09-09T13:00')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  // Everything comes back pressed and filled, so it really was stored.
  await page.goto(url)
  await expect(
    page.getByRole('group', { name: 'Painkiller prescribed' }).getByRole('button', { name: 'Yes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: 'Pethidine' }).getByRole('button', { name: '100 mg' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Painkiller given at', { exact: true })).toHaveValue('2026-09-09T14:20')
  await expect(
    page.getByRole('group', { name: 'Sickle-cell treatment identified' }).getByRole('button', { name: 'No', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(types.getByRole('button', { name: 'MRI' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Ordered', { exact: true })).toHaveValue('2026-09-09T13:00')

  // Decision E: the disposition list carries Deceased, and no ward is asked for.
  await page.getByLabel('Final disposition').selectOption('DECEASED')
  await page.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByText('Resolved: Deceased')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Resolved' })).toBeVisible()
})

/** Phase 8b, decision B: the case-management block, and its two times. */
test('the case-management block records the referral, the outcome and the two times', async ({ page }) => {
  await fromClientIp(page, '198.51.100.56')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await expect(page.getByRole('heading', { name: 'Case management' })).toBeVisible()
  // The four fields that only mean something under a referral are hidden until there is one.
  await expect(page.getByRole('group', { name: 'Criteria' })).toHaveCount(0)

  await page
    .getByRole('group', { name: 'Referred to' })
    .getByRole('button', { name: 'Complex-care coordinator' })
    .click()
  await page.getByRole('group', { name: 'Criteria' }).getByRole('button', { name: 'Meets criteria' }).click()
  await page.getByRole('group', { name: 'Action', exact: true }).getByRole('button', { name: 'For enrollment' }).click()
  await page.getByLabel('Called at', { exact: true }).fill('2026-09-09T10:00')
  await page.getByLabel('Replied at', { exact: true }).fill('2026-09-09T11:30')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  await page.goto(url)
  await expect(
    page.getByRole('group', { name: 'Referred to' }).getByRole('button', { name: 'Complex-care coordinator' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: 'Criteria' }).getByRole('button', { name: 'Meets criteria' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Called at', { exact: true })).toHaveValue('2026-09-09T10:00')
  await expect(page.getByLabel('Replied at', { exact: true })).toHaveValue('2026-09-09T11:30')

  // A reply before the call warns and never blocks (warnings.ts).
  await page.getByLabel('Replied at', { exact: true }).fill('2026-09-09T09:00')
  await expect(page.getByText('case management replied is before case management called')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
})

/** Phase 8b, decision C: the weekly deck's action category on an update. */
test('an update can carry one of the deck action categories, and shows it as a chip', async ({ page }) => {
  await fromClientIp(page, '198.51.100.57')
  const taps = await signIn(page, E2E_USERS.navigator)
  const url = await openCase(page, uniqueMrn(), STAGE, REASON, taps)

  await page
    .getByRole('group', { name: 'Action taken (optional)' })
    .getByRole('button', { name: 'Leadership escalation' })
    .click()
  await page.getByLabel('What changed?').fill('Escalated to the on-call director')
  await page.getByLabel('What changed?').press('Enter')

  const tagged = page.locator('[data-update-action="LEADERSHIP_ESCALATION"]')
  await expect(tagged).toBeVisible()
  await expect(tagged).toHaveText('Leadership escalation')
  // The chip row resets with the box, so the next update is untagged unless it is tagged again.
  await expect(
    page.getByRole('group', { name: 'Action taken (optional)' }).getByRole('button', { name: 'Leadership escalation' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await page.getByLabel('What changed?').fill('Ward says one hour')
  await page.getByLabel('What changed?').press('Enter')
  await expect(page.locator('[data-update-action]')).toHaveCount(1)

  await page.goto(url)
  await expect(page.locator('[data-update-action="LEADERSHIP_ESCALATION"]')).toHaveText('Leadership escalation')
})

/**
 * Phase 8b, decision H. The control belongs to a SUPERVISOR or an ADMIN; a navigator sees the
 * line their entry was checked on and no way to check it themselves.
 */
test('a supervisor marks a case reviewed; the navigator sees the line but not the control', async ({ browser }) => {
  const reading = await browser.newContext()
  const editing = await browser.newContext()
  const supervisor = await reading.newPage()
  const nurse = await editing.newPage()
  await fromClientIp(supervisor, '198.51.100.58')
  await fromClientIp(nurse, '198.51.100.59')

  const taps = await signIn(nurse, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  const url = await openCase(nurse, mrn, STAGE, REASON, taps)

  // Nothing to see yet, and nothing to press.
  await expect(nurse.locator('[data-review]')).toHaveCount(0)

  // Resolve it first: the board chip is for finished records, and a save would clear a review.
  await nurse.getByLabel('Final disposition').selectOption('DISCHARGED_HOME')
  await nurse.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(nurse.getByText('Resolved: Discharged home')).toBeVisible()

  await signIn(supervisor, E2E_USERS.supervisor)
  await supervisor.goto(url)
  await supervisor.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(supervisor.getByText(`Reviewed by ${E2E_USERS.supervisor.displayName}`, { exact: false })).toBeVisible()
  // A second reading is offered, and is what a "Mark again" does.
  await expect(supervisor.getByRole('button', { name: 'Mark again' })).toBeVisible()

  // The navigator reloads: the line, and no control at all.
  await nurse.goto(url)
  await expect(nurse.getByText(`Reviewed by ${E2E_USERS.supervisor.displayName}`, { exact: false })).toBeVisible()
  await expect(nurse.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0)
  await expect(nurse.getByRole('button', { name: 'Mark again' })).toHaveCount(0)

  // And the board row carries the chip.
  await nurse.goto('/?f=resolved')
  const boardRow = nurse.locator(`a[data-mrn="${mrn}"]`)
  await expect(boardRow).toBeVisible()
  await expect(boardRow.locator('[data-chip="Reviewed"]')).toBeVisible()

  await reading.close()
  await editing.close()
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
