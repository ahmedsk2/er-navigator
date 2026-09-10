import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { prisma } from '../../src/lib/db'
import { FILTER_DIMENSIONS } from '../../src/lib/domain/case-filter'
import { countCasesForExport } from '../../src/lib/export/load'
import { DEFAULT_REPORT_HEADER } from '../../src/lib/export/report-header'
import { riyadhDateKey } from '../../src/lib/export/range'
import type { ExportCountPayload } from '../../src/lib/export/service'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { DASHBOARD_CASES, DASHBOARD_MRNS, PHASE8B_MRN } from './fixtures/dashboard-cases'
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
async function fixtureWindow(): Promise<{ from: string; to: string; mrns: string[]; days: string[] }> {
  const rows = await prisma.case.findMany({
    where: { mrn: { in: [...DASHBOARD_MRNS] } },
    select: { mrn: true, registrationAt: true },
    orderBy: { registrationAt: 'asc' },
  })
  // Cases, not MRNs: Phase 8 gave one patient two visits, so the fixture writes one more case
  // than it has distinct MRNs.
  expect(rows.length, 'the dashboard fixture is seeded').toBe(DASHBOARD_CASES.length)

  // The oldest four: 700, 600, 500 and 400 hours back. The fifth is 300 hours back, so the window
  // has a real upper edge that must exclude something.
  const oldest = rows.slice(0, 4)
  const from = riyadhDateKey(oldest[0]!.registrationAt)
  const to = riyadhDateKey(oldest[3]!.registrationAt)
  return { from, to, mrns: oldest.map((r) => r.mrn), days: oldest.map((r) => riyadhDateKey(r.registrationAt)) }
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

/** Every string in a worksheet, so a value can be looked for without knowing its column. */
function sheetText(sheet: ExcelJS.Worksheet): string {
  const out: string[] = []
  sheet.eachRow((row) => {
    for (const value of (row.values as ExcelJS.CellValue[]).slice(1)) out.push(String(value ?? ''))
  })
  return out.join('\n')
}

/**
 * Phase 10, the filter. The one thing that must hold on this page: the number it shows and the
 * rows the file holds are the same number, filtered or not. Two of the four cases in the window
 * are insured (3200002 and 3200003), which is a fact of the seed, not of the clock.
 */
test('a filter narrows the count, the workbook and the printed report together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.157')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  await page.goto(`/export?from=${window.from}&to=${window.to}&status=all&format=navigator`)
  await expect(page.locator('[data-export-count]')).toHaveText(`${window.mrns.length} cases in range`)

  await page.getByRole('button', { name: 'Filter' }).click()
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  await panel.getByRole('group', { name: 'Payer' }).getByRole('button', { name: 'Insured' }).click()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  // The range survives the apply; the filter is appended after it, on the page and on both links.
  await expect(page).toHaveURL(
    `/export?from=${window.from}&to=${window.to}&status=all&format=navigator&payer=INSURED`,
  )
  await expect(page.locator('[data-export-count]')).toHaveText('2 cases in range')
  await expect(page.locator('[data-download]')).toHaveAttribute(
    'href',
    `/api/export.xlsx?from=${window.from}&to=${window.to}&status=all&format=navigator&payer=INSURED`,
  )
  await expect(page.locator('[data-print-report]')).toHaveAttribute(
    'href',
    `/report?from=${window.from}&to=${window.to}&status=all&payer=INSURED`,
  )

  // Phase 10 review: the count above is the server-rendered one, and the panel only asks
  // /api/export/count once the range moves off it — so this is the route's own reading of the
  // filter. To 3200003's day keeps both insured cases and drops 3200004; the narrower window
  // still holds 3200001, which a route that ignored the filter would count as a third.
  const insuredTo = window.days[window.mrns.indexOf('3200003')]!
  expect(insuredTo > window.from && insuredTo < window.to, 'a day inside the window').toBe(true)
  await page.getByLabel('To', { exact: true }).fill(insuredTo)
  await expect(page.locator('[data-download]')).toHaveAttribute(
    'href',
    `/api/export.xlsx?from=${window.from}&to=${insuredTo}&status=all&format=navigator&payer=INSURED`,
  )
  await expect(page.locator('[data-export-count]')).toHaveText('2 cases in range')

  // The same request the panel just made, and the same window without the filter beside it.
  const countFor = async (query: string): Promise<ExportCountPayload> => {
    const response = await page.request.get(`/api/export/count?${query}`)
    expect(response.status(), query).toBe(200)
    return (await response.json()) as ExportCountPayload
  }
  const narrowed = await countFor(`from=${window.from}&to=${insuredTo}&status=all&format=navigator&payer=INSURED`)
  expect(narrowed.count).toBe(2)
  expect(narrowed.filter?.payer).toEqual(['INSURED'])
  expect((await countFor(`from=${window.from}&to=${insuredTo}&status=all&format=navigator`)).count).toBe(3)

  // The file itself: the count on the page is the number of rows in it, and they are the two.
  const response = await page.request.get(
    `/api/export.xlsx?from=${window.from}&to=${window.to}&status=all&format=navigator&payer=INSURED`,
  )
  expect(response.status()).toBe(200)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.body()) as unknown as ExcelJS.Buffer)
  const cases = workbook.getWorksheet('Cases')!
  const mrns = (() => {
    const header = (cases.getRow(1).values as ExcelJS.CellValue[]).indexOf('MRN')
    const found: string[] = []
    cases.eachRow((row, number) => {
      if (number > 1) found.push(String(row.getCell(header).value ?? ''))
    })
    return found
  })()
  expect(mrns.sort()).toEqual(['3200002', '3200003'])

  // And the report over the same request prints which filter it was narrowed by.
  await page.goto(`/report?from=${window.from}&to=${window.to}&status=all&payer=INSURED`)
  await expect(page.locator('[data-report-filter]')).toHaveText('Filtered: Payer: Insured')
  await expect(page.locator('[data-report-range]')).toContainText('2 cases')
})

/** Every query key the case filter can put in an address: the seven dimensions and the two modes. */
const FILTER_KEYS = [...FILTER_DIMENSIONS, 'not', 'lone']

/**
 * Phase 10. The report is read on screen before it is printed, and every row on it is a drill link
 * into the dashboard. Under a filter each link must carry it, or a tapped row opens the whole
 * department under a masthead that says "Filtered"; without one, no link may carry a filter key,
 * so an unfiltered report's links stay the strings they were before the filter existed.
 */
test('the report’s drill links carry its filter, and an unfiltered report’s carry none', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.161')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  const drillLinks = async (): Promise<URLSearchParams[]> => {
    const hrefs = await page
      .locator('a[href*="drill="]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))
    return hrefs.map((href) => new URL(href, 'http://report.invalid').searchParams)
  }

  await page.goto(`/report?from=${window.from}&to=${window.to}&status=all&payer=INSURED`)
  await expect(page.locator('[data-report-filter]')).toHaveText('Filtered: Payer: Insured')
  const filtered = await drillLinks()
  expect(filtered.length, 'the filtered report has drill links').toBeGreaterThan(0)
  for (const params of filtered) expect(params.getAll('payer'), params.toString()).toEqual(['INSURED'])

  await page.goto(`/report?from=${window.from}&to=${window.to}&status=all`)
  await expect(page.locator('[data-report-filter]')).toHaveCount(0)
  const whole = await drillLinks()
  expect(whole.length, 'the unfiltered report has drill links').toBeGreaterThan(0)
  for (const params of whole) {
    for (const key of FILTER_KEYS) expect(params.has(key), `${params.toString()} carries no "${key}"`).toBe(false)
  }
})

test('each format downloads its own workbook, which opens with its own header row', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.95')
  await signIn(page, E2E_USERS.supervisor)

  const window = await fixtureWindow()
  await page.goto('/export')
  await setRange(page, window.from, window.to)
  await expect(page.locator('[data-export-count]')).toHaveText(`${window.mrns.length} cases in range`)

  const formats = [
    { format: 'navigator', file: `ER_Navigator_${window.from}_to_${window.to}.xlsx`, sheet: 'Cases', header: 1, first: 'MRN', help: 'Summary, Cases, Consults' },
    { format: 'adaa', file: `adaa-ed-kpis_${window.from}_to_${window.to}.xlsx`, sheet: 'ED KPIs manual', header: 1, first: 'Patient ID / Mandatory', help: 'columns A–T' },
    // The QCH sheet's own column names are on the second row: the first carries the groups.
    { format: 'qch', file: `qch-navigator-sheet_${window.from}_to_${window.to}.xlsx`, sheet: 'Navigator sheet', header: 1, first: 'Date', help: 'without the patient name' },
  ] as const

  for (const want of formats) {
    await page.getByLabel('Format', { exact: true }).selectOption(want.format)
    await expect(page.locator('[data-format-help]')).toContainText(want.help)
    await expect(page.locator('[data-download]')).toHaveAttribute(
      'href',
      `/api/export.xlsx?from=${window.from}&to=${window.to}&status=all&format=${want.format}`,
    )

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-download]').click(),
    ])
    expect(download.suggestedFilename(), `${want.format} is named for its format`).toBe(want.file)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(await download.path())
    const sheet = workbook.getWorksheet(want.sheet)
    expect(sheet, `${want.format} has a "${want.sheet}" sheet`).toBeTruthy()

    const header = (sheet!.getRow(want.header).values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''))
    expect(header[0], `${want.format} header starts with ${want.first}`).toBe(want.first)

    // One value per format: every case in the window is on the sheet, and none of them by name.
    const text = sheetText(sheet!)
    for (const mrn of window.mrns) expect(text, `${want.format} holds ${mrn}`).toContain(mrn)
  }
})

/**
 * Phase 8b, Slice H: one cell of each workbook that was blank before it.
 *
 * The seeded Phase 8b case registered four hours ago, so the window is yesterday and today —
 * wide enough that a run starting just after Riyadh midnight still catches it. Other specs open
 * their own cases in the same window, so every assertion finds its row by MRN rather than by
 * position and nothing here counts rows.
 */
test('the Adaa and QCH workbooks carry the Phase 8b cells', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.96')
  await signIn(page, E2E_USERS.supervisor)

  const to = riyadhDateKey(new Date())
  const from = riyadhDateKey(new Date(Date.now() - 864e5))

  const sheetOf = async (format: string, name: string): Promise<ExcelJS.Worksheet> => {
    const response = await page.request.get(`/api/export.xlsx?from=${from}&to=${to}&status=all&format=${format}`)
    expect(response.status(), `${format} downloads`).toBe(200)
    const workbook = new ExcelJS.Workbook()
    // exceljs declares its own `Buffer` interface, which Node's does not structurally satisfy.
    await workbook.xlsx.load(Buffer.from(await response.body()) as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet(name)
    expect(sheet, `${format} has a "${name}" sheet`).toBeTruthy()
    return sheet!
  }

  /** One row's cells, found by the MRN in `mrnColumn`, under `headerRows` header rows. */
  const rowFor = (sheet: ExcelJS.Worksheet, mrnColumn: number, headerRows: number, mrn: string): string[] => {
    let found: string[] | null = null
    sheet.eachRow((row, number) => {
      if (number <= headerRows) return
      if (String(row.getCell(mrnColumn).value ?? '') === mrn) {
        found = (row.values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''))
      }
    })
    expect(found, `${mrn} is on ${sheet.name}`).not.toBeNull()
    return found!
  }

  // Adaa column J, "Was a Pain Killer Prescribed?", which was blank on every row until Slice H.
  const manual = await sheetOf('adaa', 'ED KPIs manual')
  const headers = (manual.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''))
  const adaaRow = rowFor(manual, 1, 1, PHASE8B_MRN)
  expect(adaaRow[headers.indexOf('Was a Pain Killer Prescribed?')]).toBe('Yes')
  expect(adaaRow[headers.indexOf('Discharge Type / (leave blank if no discharge)')]).toBe('Deceased')

  // QCH "Referral to Case Management", likewise. Its own column names are on the FIRST row here:
  // the plain columns carry their name on the group row and leave the second one blank.
  const navigatorSheet = await sheetOf('qch', 'Navigator sheet')
  const groups = (navigatorSheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''))
  const qchRow = rowFor(navigatorSheet, 2, 2, PHASE8B_MRN)
  expect(qchRow[groups.indexOf('Referral to Case Management')]).toBe('Complex care co.')
  expect(qchRow[groups.indexOf('Reviewed By')]).toBe(E2E_USERS.supervisor.displayName)
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
