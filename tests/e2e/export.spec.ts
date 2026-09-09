import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { countCasesForExport } from '../../src/lib/export/load'
import { DEFAULT_REPORT_HEADER } from '../../src/lib/export/report-header'
import { riyadhDateKey } from '../../src/lib/export/range'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { DASHBOARD_MRNS } from './fixtures/dashboard-cases'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 5 slice through the browser: the export page's live count, the two routes behind its
 * buttons, and the printed report.
 *
 * The suite shares one database and the other spec files open their own cases while this one
 * runs, so the count is never asserted over "everything". It is asserted over a window of Riyadh
 * calendar days that only the dashboard fixture registers in — its oldest cases are twenty-nine
 * to seventeen days back, while every other fixture and every case the other specs open is hours
 * old — and the window's boundaries are read from the rows the seed actually wrote rather than
 * recomputed from the clock, so a run that starts either side of midnight still picks the same
 * days.
 */
test.describe.configure({ mode: 'serial' })

const DESKTOP_ONLY = 'the export page and the report are read on a laptop; the spec runs desktop'

/** Every .xlsx is a zip, and every zip starts with these four bytes. */
const ZIP_MAGIC = 'PK\x03\x04'

test.afterAll(async () => {
  await prisma.$disconnect()
})

/** The Riyadh days the four oldest fixture cases registered on, straight from the database. */
async function fixtureWindow(): Promise<{ from: string; to: string; mrns: string[] }> {
  const rows = await prisma.case.findMany({
    where: { mrn: { in: [...DASHBOARD_MRNS] } },
    select: { mrn: true, registrationAt: true },
    orderBy: { registrationAt: 'asc' },
  })
  expect(rows.length, 'the dashboard fixture is seeded').toBe(DASHBOARD_MRNS.length)

  // The oldest four: 700, 600, 500 and 400 hours back. The fifth is 300 hours back, so the window
  // has a real upper edge that must exclude something.
  const oldest = rows.slice(0, 4)
  const from = riyadhDateKey(oldest[0]!.registrationAt)
  const to = riyadhDateKey(oldest[3]!.registrationAt)
  return { from, to, mrns: oldest.map((r) => r.mrn) }
}

async function setRange(page: Page, from: string, to: string): Promise<void> {
  await page.getByLabel('From (registration date)', { exact: true }).fill(from)
  await page.getByLabel('To', { exact: true }).fill(to)
}

test('the export page counts exactly the cases the workbook would hold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.91')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  const expected = await countCasesForExport({
    from: window.from,
    to: window.to,
    status: 'all',
    format: 'navigator',
  })
  // Nothing but the four fixture cases registers on those days, so the count is exact.
  expect(expected, 'only the four oldest fixture cases are in the window').toBe(window.mrns.length)

  await page.goto('/export')
  await expect(page.getByRole('heading', { name: 'Export and print' })).toBeVisible()
  // The first count is server-rendered for the default range, so it is a number before any fetch.
  await expect(page.locator('[data-export-count]')).toHaveText(/^\d+ cases? in range$/)

  await setRange(page, window.from, window.to)
  await expect(page.locator('[data-export-count]')).toHaveText(`${expected} cases in range`)

  // The download link carries the range and the format the page is showing.
  await expect(page.locator('[data-download]')).toHaveAttribute(
    'href',
    `/api/export.xlsx?from=${window.from}&to=${window.to}&status=all&format=navigator`,
  )

  // Narrowing must change the answer: all four of these cases were resolved long ago.
  await page.getByLabel('Status', { exact: true }).selectOption('open')
  await expect(page.locator('[data-export-count]')).toHaveText('0 cases in range')
  await expect(page.locator('[data-download-disabled]')).toBeVisible()
  await expect(page.locator('[data-download]')).toHaveCount(0)
})

test('the workbook route serves an xlsx named for the range', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.92')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  const response = await page.request.get(
    `/api/export.xlsx?from=${window.from}&to=${window.to}&status=all`,
  )
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toBe(
    `attachment; filename="ER_Navigator_${window.from}_to_${window.to}.xlsx"`,
  )
  const body = await response.body()
  expect(body.subarray(0, 4).toString('latin1')).toBe(ZIP_MAGIC)
  expect(body.byteLength).toBeGreaterThan(2_000)
})

test('a navigator may not export, and is told so rather than shown an empty page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.93')
  await signIn(page, E2E_USERS.navigator)

  // The tab is not offered.
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Export' })).toHaveCount(0)

  // Phase 7: a real 403, not a 200 whose body says no. `requireAction` writes the audit row and
  // then calls Next's `forbidden()`, which renders app/forbidden.tsx at that status.
  const refused = await page.goto('/export')
  expect(refused?.status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible()

  expect((await page.request.get('/api/export.xlsx')).status()).toBe(403)
  expect((await page.request.get('/api/export/count')).status()).toBe(403)

  const refusedReport = await page.goto('/report')
  expect(refusedReport?.status()).toBe(403)
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible()
})

test('the report prints the hospital header, the range and the threshold table', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.94')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  const to = riyadhDateKey(new Date())
  await page.goto(`/report?from=${window.from}&to=${to}&status=all`)

  await expect(page.locator('[data-report-header]')).toHaveText(DEFAULT_REPORT_HEADER)
  await expect(page.locator('[data-report-range]')).toContainText(`${window.from} to ${to}`)
  await expect(page.locator('[data-report-meta]')).toContainText(E2E_USERS.supervisor.displayName)

  await expect(page.getByRole('heading', { name: 'Cases past each threshold' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Over 12h' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Over 24h' })).toBeVisible()

  // A report is one screen with one job: no tab bar, no floating "+ New case".
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
})
