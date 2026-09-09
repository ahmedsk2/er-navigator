import { expect, test, type Page } from '@playwright/test'
import type { BoardPayload } from '../../src/lib/board/types'
import { inRange, type CaseForStats, type Range } from '../../src/lib/domain/aggregates'
import { MIN_N, elapsedHours, fmtHours, median } from '../../src/lib/domain/time'
import { fromClientIp, signIn } from './fixtures/case-flow'
import {
  DASHBOARD_CASES,
  DASHBOARD_MRNS,
  DASHBOARD_OTHER_TEXT,
  WITHIN_7_DAYS,
  fixtureMrnsOver,
} from './fixtures/dashboard-cases'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 4 slice through the browser, at both plan viewports (the dashboard is the one screen
 * leadership reads on a laptop as well as on a phone, so unlike the board it is checked at both).
 *
 * Two kinds of assertion, because the suite shares one database and the other spec files are
 * opening their own cases while this one runs:
 *
 *   - Anything MRN-shaped is asserted over the seeded `32000…` fixture only — the drill-down must
 *     list exactly the fixture cases past the threshold and none of the ones below it.
 *   - The three tiles are whole-database numbers, so they are cross-checked against
 *     `GET /api/board`, recomputed with the same tested pure functions the page calls. That is a
 *     real check (two independent server paths must agree) and it cannot go stale.
 */
test.describe.configure({ mode: 'serial' })

const rowFor = (page: Page, mrn: string) => page.locator(`a[data-mrn="${mrn}"]`)
const tile = (page: Page, label: string) => page.locator(`[data-tile="${label}"]`)

type Tiles = { openNow: number; openPast6: number; medianLos: string }

/** The board payload as `CaseForStats` clocks — every field the three tiles depend on. */
function clocksOf(payload: BoardPayload): CaseForStats[] {
  return payload.rows.map(
    (row) =>
      ({
        id: row.id,
        mrn: row.mrn,
        status: row.status,
        registrationAt: new Date(row.registrationAt),
        departedAt: row.departedAt ? new Date(row.departedAt) : null,
        resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
        shift: null,
        primaryReasonName: null,
        stageNames: [],
        departmentNames: [],
        disposition: null,
        consults: [],
        investigations: [],
        // The tiles depend on the clock alone, so everything else is the empty value a case
        // with nothing recorded really has.
        triageAt: null,
        physicianAt: null,
        decisionAt: null,
        admOrderAt: null,
        bedRequestedAt: null,
        bedAssignedAt: null,
        handoverAt: null,
        transferRequestedAt: null,
        medAdminInformedAt: null,
        wardCode: null,
        ctas: null,
        areaName: null,
        updatesCount: 0,
        lastUpdateAt: null,
        otherTexts: [],
      }) satisfies CaseForStats,
  )
}

/** What the tiles must read, computed from the board API with the page's own pure functions. */
async function tilesFromApi(page: Page, range: Range): Promise<Tiles> {
  const response = await page.request.get('/api/board?f=all')
  expect(response.status()).toBe(200)
  const payload = (await response.json()) as BoardPayload
  const now = new Date(payload.now)
  const cases = inRange(clocksOf(payload), range, now)
  const open = cases.filter((c) => c.status === 'OPEN')
  const resolved = cases.filter((c) => c.status === 'RESOLVED')
  return {
    openNow: open.length,
    openPast6: open.filter((c) => (elapsedHours(c, now) ?? -1) >= 6).length,
    medianLos:
      resolved.length < MIN_N ? `n<${MIN_N}` : fmtHours(median(resolved.map((c) => elapsedHours(c, now)))),
  }
}

async function readTiles(page: Page): Promise<Tiles> {
  return {
    openNow: Number(await tile(page, 'Open now').innerText()),
    openPast6: Number(await tile(page, 'Open past 6h').innerText()),
    medianLos: (await tile(page, 'Median LOS, resolved').innerText()).trim(),
  }
}

/**
 * Load the dashboard and read the tiles against a board snapshot taken either side of the render,
 * so a case another spec opens mid-test is a retry rather than a red. Three attempts is plenty:
 * the other files open one case every few seconds.
 */
async function tilesAgreeWithBoard(page: Page, range: Range): Promise<void> {
  for (let attempt = 3; attempt > 0; attempt -= 1) {
    const before = await tilesFromApi(page, range)
    await page.goto(range === '30' ? '/dashboard' : `/dashboard?r=${range}`)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    const shown = await readTiles(page)
    const after = await tilesFromApi(page, range)
    if (JSON.stringify(before) === JSON.stringify(after)) {
      expect(shown).toEqual(before)
      return
    }
    if (attempt === 1) expect(shown, 'the board kept changing under the dashboard').toEqual(after)
  }
}

test('the dashboard tiles agree with the board, and the threshold table has the four bands', async ({
  page,
}, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.91' : '198.51.100.92')
  await signIn(page, E2E_USERS.navigator)

  await tilesAgreeWithBoard(page, '30')

  // "{inRange} of {total} cases", and every seeded case is inside the default 30 days.
  const subtitle = await page.locator('[data-subtitle]').innerText()
  expect(subtitle).toMatch(/^\d+ of \d+ cases$/)

  // Four thresholds, coloured by band, each a link into its own case list.
  const thresholds = page.getByRole('link', { name: /^Over \d+h$/ })
  await expect(thresholds).toHaveCount(4)
  expect(await thresholds.evaluateAll((els) => els.map((e) => e.textContent))).toEqual([
    'Over 4h',
    'Over 6h',
    'Over 12h',
    'Over 24h',
  ])
  await expect(
    page.getByText(
      'Tap a row to see the cases. Open now counts wait so far; All cases counts total stay including resolved.',
    ),
  ).toBeVisible()
})

test('tapping "Over 6h" lists exactly the seeded cases past six hours', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.93' : '198.51.100.94')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  await page.getByRole('link', { name: 'Over 6h' }).click()
  await expect(page).toHaveURL('/dashboard?drill=threshold%3A6')
  await expect(page.locator('[data-drill-label]')).toHaveText('Cases over 6h')
  await expect(page.locator('[data-drill-count]')).toHaveText(/^\d+ cases$/)

  const over = fixtureMrnsOver(6)
  const under = DASHBOARD_MRNS.filter((mrn) => !over.includes(mrn))
  expect(over).toEqual(['3200001', '3200002', '3200003', '3200004', '3200007', '3200008', '3200009', '3200010'])
  for (const mrn of over) await expect(rowFor(page, mrn), `${mrn} is past 6h`).toHaveCount(1)
  for (const mrn of under) await expect(rowFor(page, mrn), `${mrn} is not past 6h`).toHaveCount(0)

  // Longest stay first, as the prototype's drill-down sorts. An open case's clock is still
  // running, so where a nominal figure is shared (26h, 7h) the open one sorts above the resolved.
  const shown = await page
    .locator('a[data-mrn]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-mrn')))
  const seeded = shown.filter((mrn): mrn is string => !!mrn && DASHBOARD_MRNS.includes(mrn))
  expect(seeded).toEqual(['3200007', '3200008', '3200001', '3200002', '3200009', '3200003', '3200010', '3200004'])

  // And back again.
  await page.getByRole('link', { name: '‹ Dashboard' }).click()
  await expect(page).toHaveURL('/dashboard')
  await expect(page.getByRole('heading', { name: 'Cases past each threshold' })).toBeVisible()
})

test('the range chips change the subtitle and what the page counts', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.95' : '198.51.100.96')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  const countOf = async (): Promise<{ inRange: number; total: number }> => {
    const text = await page.locator('[data-subtitle]').innerText()
    const [, a, b] = /^(\d+) of (\d+) cases$/.exec(text) ?? []
    return { inRange: Number(a), total: Number(b) }
  }

  const thirty = await countOf()
  await page.getByRole('link', { name: '7 days' }).click()
  await expect(page).toHaveURL('/dashboard?r=7')
  const seven = await countOf()

  // Six of the twelve seeded cases registered more than a week ago, so a week counts strictly
  // fewer. The totals are only compared for direction: another spec file may open a case between
  // these two renders, and the whole-database total can grow but never shrink.
  expect(DASHBOARD_CASES.length - WITHIN_7_DAYS.length).toBe(6)
  expect(seven.inRange).toBeLessThan(thirty.inRange)
  expect(seven.total).toBeGreaterThanOrEqual(thirty.total)

  await page.getByRole('link', { name: 'All time' }).click()
  await expect(page).toHaveURL('/dashboard?r=all')
  const all = await countOf()
  expect(all.inRange).toBe(all.total)
  expect(all.inRange).toBeGreaterThanOrEqual(thirty.inRange)

  // What the range actually does, asserted on named cases rather than on a count another spec
  // can move: 3200001 registered twenty-nine days ago and stayed 26 h, 3200007 four days ago and
  // stayed 30 h. Both are past 24 h; only the second is inside a week.
  await page.goto('/dashboard?drill=threshold%3A24')
  await expect(rowFor(page, '3200001')).toHaveCount(1)
  await expect(rowFor(page, '3200007')).toHaveCount(1)
  await page.goto('/dashboard?r=7&drill=threshold%3A24')
  await expect(rowFor(page, '3200001')).toHaveCount(0)
  await expect(rowFor(page, '3200007')).toHaveCount(1)
  await page.goto('/dashboard?r=all')

  // The chosen chip is the current one, and it survives a reload.
  await page.reload()
  await expect(page.getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'true')
})

test('the Other queue shows the seeded text and links to its case', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.97' : '198.51.100.98')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  await expect(page.getByRole('heading', { name: /^Other reasons awaiting review \(\d+\)$/ })).toBeVisible()
  const entry = page.getByRole('link', { name: new RegExp(DASHBOARD_OTHER_TEXT) })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('Discharge process')
  await expect(entry).toContainText('3200012')
  await expect(entry).toHaveAttribute('href', /^\/cases\/[a-z0-9]+$/)
})

test('every section the seeded data earns is on the page, charts included', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.99' : '198.51.100.100')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  for (const heading of [
    'Cases past each threshold',
    'By week: cases and median stay',
    'Primary delay reason',
    'Journey stage where delays occur',
    'Departments involved',
    'Consulted team response, median',
    'Investigation turnaround, median from order',
    'Admission chain, median',
    'By shift',
    'By day of week',
    'Final disposition',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  // The two client charts actually mounted.
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()

  // MROD was consulted on four seeded cases, so its median is a number and not "n<3".
  const mrod = page.getByRole('row', { name: /^MROD/ })
  await expect(mrod).toContainText(/\dh \d\dm/)

  // The shift table names the three shifts in sentence case, never the enum.
  await expect(page.getByRole('link', { name: 'Morning', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'MORNING', exact: true })).toHaveCount(0)

  // A row drill-down out of a table other than the thresholds.
  await page.getByRole('link', { name: 'Night', exact: true }).click()
  await expect(page).toHaveURL('/dashboard?drill=shift%3ANIGHT')
  await expect(page.locator('[data-drill-label]')).toHaveText('Night shift')
  await expect(rowFor(page, '3200009')).toHaveCount(1)
})

test('an unknown drill key renders the dashboard rather than an error', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.101' : '198.51.100.102')
  await signIn(page, E2E_USERS.navigator)

  for (const drill of ['nonsense', 'nonsense:MROD', 'threshold:99', 'dept:Not+A+Department', '../../etc']) {
    const response = await page.goto(`/dashboard?drill=${encodeURIComponent(drill)}`)
    expect(response?.status(), drill).toBe(200)
    await expect(page.getByRole('heading', { name: 'Dashboard' }), drill).toBeVisible()
    await expect(page.locator('[data-drill-label]'), drill).toHaveCount(0)
  }
})

test('the dashboard needs a session', async ({ page }) => {
  const response = await page.goto('/dashboard?r=7&drill=threshold%3A6')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL('/login?next=%2Fdashboard%3Fr%3D7%26drill%3Dthreshold%253A6')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
