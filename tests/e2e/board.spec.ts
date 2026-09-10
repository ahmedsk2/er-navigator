import { expect, test, type Page } from '@playwright/test'
import { BOARD_CASES, BOARD_MRN_PREFIX, LONGEST, RESOLVED, VOIDED } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 3 slice through the browser. Mobile only: the board is designed at 390 px and the
 * desktop rendering is the same single column, which the gate screenshots cover.
 *
 * Every assertion narrows to the seeded fixtures first (their MRNs all start `31`, which nothing
 * else uses), because the other spec files open cases against the same database in parallel.
 */
test.describe.configure({ mode: 'serial' })
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'mobile', 'the board is checked at the phone size')
})

const rowFor = (page: Page, mrn: string) => page.locator(`a[data-mrn="${mrn}"]`)

/** Type the shared prefix so only the seeded fixtures are on screen. */
async function narrowToFixtures(page: Page): Promise<void> {
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(rowFor(page, LONGEST.mrn)).toBeVisible()
}

test('the board lists the seeded open cases, longest stay first, banded and clocked', async ({ page }) => {
  await fromClientIp(page, '198.51.100.71')
  await signIn(page, E2E_USERS.navigator)

  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await expect(page.getByText(/\d+ open · \d+ past 6h · \d+ past 12h/)).toBeVisible()
  await narrowToFixtures(page)

  // The six open fixtures, in the order their clocks demand, and no resolved or voided one.
  const open = ['3100001', '3100002', '3100003', '3100004', '3100005', '3100006']
  await expect(page.locator('a[data-mrn]')).toHaveCount(open.length)
  expect(await page.locator('a[data-mrn]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mrn')))).toEqual(
    open,
  )
  await expect(rowFor(page, RESOLVED.mrn)).toHaveCount(0)
  await expect(rowFor(page, VOIDED.mrn)).toHaveCount(0)

  // One band per threshold, straight off the row.
  const bands: Record<string, string> = {
    '3100001': 'h24',
    '3100002': 'h12',
    '3100003': 'h6',
    '3100004': 'h4',
    '3100005': 'h4',
    '3100006': 'ok',
  }
  for (const [mrn, band] of Object.entries(bands)) {
    await expect(rowFor(page, mrn)).toHaveAttribute('data-band', band)
  }

  // The clock, the registration stamp and the reason line of the longest stay.
  const longest = rowFor(page, LONGEST.mrn)
  await expect(longest).toContainText(/30h \d\dm/)
  await expect(longest).toContainText('reg ')
  await expect(longest).toContainText(LONGEST.reason.name)
  await expect(longest).toHaveAttribute('href', /^\/cases\/[a-z0-9]+$/)

  // Staleness: amber past two hours, plain before it.
  await expect(longest).toContainText(/No update for 12h \d\dm/)
  await expect(rowFor(page, '3100003')).toContainText(/No update for 7h \d\dm/)
  await expect(rowFor(page, '3100004')).toContainText(/Updated 0h \d\dm ago/)

  // Consulted teams follow the primary reason on line 2.
  await expect(rowFor(page, '3100002')).toContainText('Internal Medicine, ICU')
})

test('searching narrows to one MRN, keeps it on a refresh and says so when nothing matches', async ({ page }) => {
  await fromClientIp(page, '198.51.100.72')
  await signIn(page, E2E_USERS.navigator)

  await page.getByLabel('Search MRN').fill('3100002')
  await expect(page.locator('a[data-mrn]')).toHaveCount(1)
  await expect(rowFor(page, '3100002')).toBeVisible()
  await expect(page).toHaveURL('/?q=3100002')

  // Non-digits are stripped before the match, exactly as the prototype does.
  await page.getByLabel('Search MRN').fill('31000-02')
  await expect(rowFor(page, '3100002')).toBeVisible()
  await expect(page.locator('a[data-mrn]')).toHaveCount(1)

  await page.reload()
  await expect(page.getByLabel('Search MRN')).toHaveValue('31000-02')
  await expect(rowFor(page, '3100002')).toBeVisible()

  await page.getByLabel('Search MRN').fill('3100099')
  await expect(page.getByText('No case matching 3100099.')).toBeVisible()
})

test('the Resolved filter shows the resolved case with its outcome, and never the voided one', async ({ page }) => {
  await fromClientIp(page, '198.51.100.73')
  await signIn(page, E2E_USERS.navigator)

  await page.getByRole('link', { name: 'Resolved', exact: true }).click()
  await expect(page).toHaveURL('/?f=resolved')
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)

  await expect(rowFor(page, RESOLVED.mrn)).toBeVisible()
  await expect(rowFor(page, RESOLVED.mrn)).toContainText('Admitted · ICU')
  await expect(rowFor(page, '3100008')).toContainText('Discharged home')
  await expect(rowFor(page, LONGEST.mrn)).toHaveCount(0)
  await expect(rowFor(page, VOIDED.mrn)).toHaveCount(0)

  // The counts strip still counts the open cases, not the ones on screen.
  await expect(page.getByText(/[1-9]\d* open · \d+ past 6h · \d+ past 12h/)).toBeVisible()

  await page.getByRole('link', { name: 'All', exact: true }).click()
  await expect(page).toHaveURL(/\/\?f=all/)
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator('a[data-mrn]')).toHaveCount(BOARD_CASES.length - 1)
  await expect(rowFor(page, VOIDED.mrn)).toHaveCount(0)
})

/**
 * Phase 10, Slice 10C. The row's summary button: the same panel the case page opens, over a
 * summary fetched on the tap, without leaving the board.
 *
 * The count assertion is the point of the test as much as the panel is. The button is a sibling
 * of the row's link and never a child of it, and three specs count the board by `a[data-mrn]`.
 */
test('a row opens its summary without leaving the board, and adds no second link', async ({ page }) => {
  await fromClientIp(page, '198.51.100.79')
  await signIn(page, E2E_USERS.navigator)
  await narrowToFixtures(page)

  const rows = await page.locator('a[data-mrn]').count()
  expect(rows).toBeGreaterThan(0)

  await page.locator(`[data-summary-for="${LONGEST.mrn}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(LONGEST.mrn)
  await expect(dialog).toContainText(LONGEST.reason.name)
  await expect(dialog).toContainText('Registration')

  // One row, one link: the control that opened this is not one of them.
  await expect(page.locator('a[data-mrn]')).toHaveCount(rows)
  // Still the board: opening the panel is not a navigation.
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(`[data-summary-for="${LONGEST.mrn}"]`)).toBeFocused()
})

test('a viewer reads the board but gets no New case button', async ({ page }) => {
  await fromClientIp(page, '198.51.100.74')
  await signIn(page, E2E_USERS.viewer)

  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()
  await narrowToFixtures(page)
  await expect(page.getByRole('link', { name: '+ New case' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Board', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Export', exact: true })).toBeVisible()
})

test('a navigator gets the New case button, and it is gone inside the editor', async ({ page }) => {
  await fromClientIp(page, '198.51.100.75')
  await signIn(page, E2E_USERS.navigator)

  const fab = page.getByRole('link', { name: '+ New case' })
  await expect(fab).toBeVisible()
  await fab.click()
  await expect(page).toHaveURL('/cases/new')
  await expect(page.getByRole('link', { name: '+ New case' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
})

test('the overflow menu holds the name, the print action and logging out', async ({ page }) => {
  await fromClientIp(page, '198.51.100.76')
  await signIn(page, E2E_USERS.navigator)

  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Print handover' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()

  await page.getByRole('menuitem', { name: `${E2E_USERS.navigator.displayName} · Navigator` }).click()
  await expect(page).toHaveURL('/account')
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
})

test('printing the board gives the handover sheet, not the screen', async ({ page }) => {
  await fromClientIp(page, '198.51.100.77')
  await signIn(page, E2E_USERS.navigator)
  await narrowToFixtures(page)

  await page.emulateMedia({ media: 'print' })

  const sheet = page.locator('section.print-only')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Qatif Central Hospital, Emergency Department. ER Navigator handover')
  await expect(sheet).toContainText(E2E_USERS.navigator.displayName)
  await expect(sheet).toContainText('(Asia/Riyadh)')
  await expect(page.getByRole('columnheader', { name: 'MRN' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Ward / disposition' })).toBeVisible()
  await expect(page.getByRole('cell', { name: LONGEST.mrn })).toBeVisible()

  // The app is gone: search, chips, rows, tab bar and the floating button.
  await expect(page.getByLabel('Search MRN')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Resolved', exact: true })).toBeHidden()
  await expect(rowFor(page, LONGEST.mrn)).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden()
  await expect(page.getByRole('link', { name: '+ New case' })).toBeHidden()

  await page.emulateMedia({ media: 'screen' })
})

/**
 * Review C19. The poll is a 30 s beat, so these two tests wait for one real tick rather than
 * faking a clock the hydrated board also reads.
 */
const ONE_POLL_MS = 45_000

/** The session cookie, by name: importing `src/lib/auth/session` here would pull in next/headers. */
const SESSION_COOKIE = '__Host-ern_session'

test('a failed poll says the board has stopped updating, and keeps the rows on screen', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await fromClientIp(page, '198.51.100.79')
  await signIn(page, E2E_USERS.navigator)
  await narrowToFixtures(page)

  // The first paint is the server's, so the line is honest before any poll has run.
  await expect(page.locator('[data-board-freshness]')).toHaveText(/^Updated \d\d:\d\d$/)

  await page.route(/\/api\/board/, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }),
  )

  await expect(page.locator('[data-board-freshness="stale"]')).toHaveText(
    /^Not updating since \d\d:\d\d\. Check the connection\.$/,
    { timeout: ONE_POLL_MS },
  )
  // The list is not thrown away: a stale board that admits it beats an empty one.
  await expect(rowFor(page, LONGEST.mrn)).toBeVisible()
})

test('a 401 from the poll sends the phone to the login form and clears the cookie', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000)
  await fromClientIp(page, '198.51.100.80')
  await signIn(page, E2E_USERS.navigator)
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()

  // What a deactivated account, or a session logged out on another device, actually gets.
  await page.route(/\/api\/board/, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }),
  )

  await page.waitForURL(/\/login\?expired=1$/, { timeout: ONE_POLL_MS })
  await expect(page.getByLabel('Username')).toBeVisible()

  // `?expired=1` is the path the route gate answers by clearing both cookies.
  const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)
  expect(session?.value ?? '').toBe('')
})

test('GET /api/board needs a session, honours f and never returns a voided case', async ({ page, request }) => {
  const signedOut = await request.get('/api/board')
  expect(signedOut.status()).toBe(401)

  await fromClientIp(page, '198.51.100.78')
  await signIn(page, E2E_USERS.navigator)

  const read = async (search: string): Promise<{ rows: Array<{ mrn: string; status: string }> }> =>
    page.evaluate(async (s) => {
      const response = await fetch(`/api/board${s}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`board api answered ${response.status}`)
      return response.json()
    }, search)

  const open = await read('')
  expect(open.rows.map((r) => r.mrn)).toContain(LONGEST.mrn)
  expect(open.rows.map((r) => r.mrn)).not.toContain(RESOLVED.mrn)
  expect(open.rows.every((r) => r.status === 'OPEN')).toBe(true)

  const resolved = await read('?f=resolved')
  expect(resolved.rows.map((r) => r.mrn)).toContain(RESOLVED.mrn)
  expect(resolved.rows.every((r) => r.status === 'RESOLVED')).toBe(true)

  const all = await read('?f=all')
  expect(all.rows.map((r) => r.mrn)).toEqual(expect.arrayContaining([LONGEST.mrn, RESOLVED.mrn]))

  // Nothing, on any filter, may leak a voided case — including one asking for it by name.
  for (const search of ['', '?f=resolved', '?f=all', '?f=voided']) {
    const payload = await read(search)
    expect(payload.rows.map((r) => r.mrn)).not.toContain(VOIDED.mrn)
  }
})
