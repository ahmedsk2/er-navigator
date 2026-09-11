import { expect, test, type Page } from '@playwright/test'
import { riyadhDateKey } from '../../src/lib/export/range'
import { DEFAULT_REPORT_HEADER } from '../../src/lib/export/report-header'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 12: the mark on the two surfaces that leave the building on paper.
 *
 * Phase 11 put the mark in the shell header, the login hero, the holding screens and the
 * home-screen icons; the printed report and the shift handover sheet were still text alone, so a
 * sheet on a ward noticeboard or a report in a monthly meeting carried nothing that said which
 * app it came from. Both now open with `Mark tone="onWhite"` — a teal tile with a white cross,
 * which is the tone that reads on white paper, and an SVG fill rather than a CSS background, so
 * it survives a browser that drops background printing.
 *
 * What this spec pins is the part that is easy to break: the mark is *beside* each title, never
 * inside it. `tests/e2e/export.spec.ts` asserts the report's `<h1>` has exactly the header line
 * and `tests/e2e/board.spec.ts` reads the sheet's narrowing line as `h2 + p + [data-sheet-...]`,
 * so a wrapper around either title would fail somewhere else in the suite rather than here.
 */
test.describe.configure({ mode: 'serial' })

/** The seeded thirty days, the range the report gate screenshots use. */
function reportUrl(): string {
  const today = riyadhDateKey(new Date())
  const monthAgo = riyadhDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  return `/report?from=${monthAgo}&to=${today}&status=all`
}

async function gotoReport(page: Page): Promise<void> {
  await page.goto(reportUrl())
  await expect(page.locator('[data-report-header]')).toBeVisible()
}

test('the report masthead opens with the mark, and its heading is still only the header line', async ({
  page,
}, testInfo) => {
  await fromClientIp(page, '198.51.100.251')
  // The report is `report.print`: a supervisor, as the export spec signs in.
  await signIn(page, E2E_USERS.supervisor)
  await gotoReport(page)

  const mark = page.locator('[data-report-mark] svg')
  await expect(mark).toHaveCount(1)
  await expect(mark).toBeVisible()
  await expect(mark).toHaveAttribute('data-mark', 'onWhite')

  // Beside the heading, not inside it.
  await expect(page.locator('[data-report-header]')).toHaveText(DEFAULT_REPORT_HEADER)
  await expect(page.locator('[data-report-header] svg')).toHaveCount(0)

  // Left of the heading block, on the heading's own line.
  const markBox = (await mark.boundingBox())!
  const headingBox = (await page.locator('[data-report-header]').boundingBox())!
  const printBox = (await page.getByRole('button', { name: 'Print' }).boundingBox())!
  expect(markBox.x + markBox.width).toBeLessThanOrEqual(headingBox.x)
  expect(markBox.y).toBeLessThan(headingBox.y + headingBox.height)

  // The masthead still wraps the way it did: the Print button at the right on a laptop, and under
  // the whole heading block on a phone — never squeezed beside the mark.
  if (testInfo.project.name === 'desktop') {
    expect(printBox.x).toBeGreaterThan(headingBox.x + headingBox.width - 1)
  } else {
    expect(printBox.y).toBeGreaterThanOrEqual(markBox.y + markBox.height)
  }

  // The range and the stamp are where they were, under the heading rather than beside the mark.
  await expect(page.locator('[data-report-range]')).toContainText('Report ·')
  await expect(page.locator('[data-report-meta]')).toContainText(E2E_USERS.supervisor.displayName)
})

test('the report masthead fits the phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the 390 px width is what the phone project is for')
  await fromClientIp(page, '198.51.100.252')
  await signIn(page, E2E_USERS.supervisor)
  await gotoReport(page)

  // The masthead itself: nothing inside it is wider than it is.
  const header = page.locator('.dash > header')
  const masthead = await header.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(masthead.scroll).toBeLessThanOrEqual(masthead.client)

  // And the page: no sideways scrollbar on a phone.
  const page390 = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(page390.scroll).toBeLessThanOrEqual(page390.inner)
})

test('the handover sheet opens with the mark beside its title', async ({ page }) => {
  await fromClientIp(page, '198.51.100.253')
  await signIn(page, E2E_USERS.navigator)

  const sheet = page.locator('section.print-only')
  await page.emulateMedia({ media: 'print' })
  await expect(sheet).toBeVisible()

  const mark = sheet.locator('[data-handover-mark] svg')
  await expect(mark).toHaveCount(1)
  await expect(mark).toBeVisible()
  await expect(mark).toHaveAttribute('data-mark', 'onWhite')

  // The title the sheet has always printed, unchanged, and the stamp still straight after it:
  // board.spec.ts reads the narrowing line as `h2 + p + [data-sheet-narrowed]`.
  await expect(sheet).toContainText('Qatif Central Hospital, Emergency Department. ER Navigator handover')
  await expect(sheet.locator('h2 + p')).toHaveCount(1)

  await page.emulateMedia({ media: 'screen' })
})
