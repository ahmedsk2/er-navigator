import { expect, test, type Locator, type Page } from '@playwright/test'
import type { BoardPayload } from '../../src/lib/board/types'
import { inRange, type CaseForStats, type Range } from '../../src/lib/domain/aggregates'
import { headline } from '../../src/lib/domain/kpi'
import { MIN_N, fmtHours } from '../../src/lib/domain/time'
import { riyadhDateKey } from '../../src/lib/export/range'
import { fromClientIp, signIn } from './fixtures/case-flow'
import {
  DASHBOARD_CASES,
  DASHBOARD_MRNS,
  DASHBOARD_OTHER_TEXT,
  PHASE8B_MRN,
  REPEAT_MRN,
  WITHIN_7_DAYS,
  fixtureMrnsInBand,
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

type Tiles = { cases: number; episodes: number; medianStay: string }

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
        roomAt: null,
        physicianAt: null,
        decisionAt: null,
        admOrderAt: null,
        bedRequestedAt: null,
        bedAssignedAt: null,
        transferRequestedAt: null,
        transferAcceptedAt: null,
        transportArrivedAt: null,
        medAdminInformedAt: null,
        wardCode: null,
        ctas: null,
        areaName: null,
        areaCode: null,
        updatesCount: 0,
        lastUpdateAt: null,
        painkillerPrescribed: null,
        pethidinePrescribed: null,
        pethidineDoseMg: null,
        painkillerAt: null,
        sickleCellTreatment: null,
        instructionsGiven: null,
        familyEngagement: null,
        caseMgmtReferral: null,
        caseMgmtCriteria: null,
        caseMgmtAction: null,
        caseMgmtCalledAt: null,
        caseMgmtRepliedAt: null,
        reviewedAt: null,
        reviewedByName: null,
        updateActions: [],
        untaggedUpdatesCount: 0,
        payer: null,
        stageCodes: [],
        reasonNames: [],
        otherTexts: [],
      }) satisfies CaseForStats,
  )
}

/**
 * What the tiles must read, computed from the board API with the page's own pure functions.
 *
 * Phase 8 replaced the three Phase 4 tiles with the weekly deck's headline, so the cross-check is
 * now `headline()` from the KPI module over the same board snapshot: two independent server paths
 * that must agree, and a check that cannot go stale.
 */
async function tilesFromApi(page: Page, range: Range): Promise<Tiles> {
  const response = await page.request.get('/api/board?f=all')
  expect(response.status()).toBe(200)
  const payload = (await response.json()) as BoardPayload
  const now = new Date(payload.now)
  const head = headline(inRange(clocksOf(payload), range, now), now)
  return {
    cases: head.cases,
    episodes: head.episodes,
    medianStay: head.med == null ? `n<${MIN_N}` : fmtHours(head.med),
  }
}

async function readTiles(page: Page): Promise<Tiles> {
  return {
    cases: Number(await tile(page, 'Cases').innerText()),
    episodes: Number(await tile(page, 'Episodes').innerText()),
    medianStay: (await tile(page, 'Median stay').innerText()).trim(),
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

test('the headline tiles agree with the board, and the threshold table has the four bands', async ({
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
    // Phase 10: the stay in three parts; the seed records physician and decision times. And the
    // payer table, which the seed earns by recording a payer on two cases.
    'Where the time goes',
    'By payer',
    // Phase 11: the thirty-day page draws its last days by day; the weekly chart is 90 days and
    // all time now (the test of the daily chart below checks both).
    'By day: cases and median stay',
    'Primary delay reason',
    // Phase 8 renamed "Journey stage where delays occur" to the weekly deck's own word.
    'Pathways',
    'Departments involved',
    'Consulted team response, median',
    'Investigation turnaround, median from order',
    'Admission chain, median',
    'By shift',
    'By day of week',
    // …and replaced "Final disposition" with the outcome mix, which also counts the open cases.
    'Outcomes',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  // The trend chart actually mounted, and the bar sections drew (plain HTML since Phase 11).
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] [data-bar]').first()).toBeVisible()

  // MROD was consulted on four seeded cases, so its median is a number and not "n<3". Scoped to
  // this table: Phase 8's "Exam to consult, median" names the same teams a few sections down.
  const consultTable = page
    .getByRole('heading', { name: 'Consulted team response, median', exact: true })
    .locator('xpath=../table')
  await expect(consultTable.getByRole('row', { name: /^MROD/ })).toContainText(/\dh \d\dm/)

  // The shift table names the three shifts in sentence case, never the enum.
  await expect(page.getByRole('link', { name: 'Morning', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'MORNING', exact: true })).toHaveCount(0)

  // A row drill-down out of a table other than the thresholds.
  await page.getByRole('link', { name: 'Night', exact: true }).click()
  await expect(page).toHaveURL('/dashboard?drill=shift%3ANIGHT')
  await expect(page.locator('[data-drill-label]')).toHaveText('Night shift')
  await expect(rowFor(page, '3200009')).toHaveCount(1)
})

/**
 * Phase 8. The seeded fixture now carries a CTAS, an ED area, the journey milestones, an imaging
 * preliminary read, updates, an escalation, a transfer request and one repeat MRN, so every new
 * section has something real to draw.
 *
 * Section headings are asserted whole-database (they render for anyone's data); every number-bearing
 * claim is made through a drill-down on the `32000…` MRNs, which is the only set this file owns.
 */
test('every Phase 8 section renders, with its footnote and its chart', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.103' : '198.51.100.104')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  for (const heading of [
    'Stay bands',
    'Pathways',
    'Adaa KPIs, tracked cases only',
    'Working targets',
    'Admission to unit',
    'Turnaround: order to result',
    'Exam to consult, median',
    'Longest stays',
    'Actions documented',
    'Outcomes',
    'By CTAS',
    'By ED area',
    'Repeat visits',
    'Documentation',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true }), heading).toBeVisible()
  }

  // The Phase 4 tile row is gone, replaced by the seven headline tiles.
  await expect(tile(page, 'Open past 6h')).toHaveCount(0)
  for (const label of ['Cases', 'Episodes', 'Median stay', 'Mean stay', 'Range', '10 h or more', 'Longest stay']) {
    await expect(tile(page, label), label).toBeVisible()
  }
  // The longest stay is the only tile that is a link, and it points at a case.
  await expect(page.locator('[data-tile="Longest stay"]').locator('xpath=ancestor::a')).toHaveAttribute(
    'href',
    /^\/cases\/[a-z0-9]+$/,
  )

  // The quoted footnote, word for word (Phase 8 spec, Slice E, section 4).
  await expect(
    page.getByText('Tracked cases, not the whole ED. Benchmarks: Adaa ED KPI definitions.'),
  ).toBeVisible()

  // The six Adaa rows, and the stacked turnaround chart actually mounted.
  for (const kpi of ['KPI 1 · Door to doctor, median', 'KPI 5 · Door to disposition within 4 h', 'KPI 4 · CTAS 4 or 5']) {
    await expect(page.getByRole('cell', { name: kpi, exact: true }), kpi).toBeVisible()
  }
  await expect(page.locator('[data-chart="stacked"] svg[role="application"]')).toBeVisible()

  // Every seeded case has a delay reason and a stay, so those two checks read zero; the seeded
  // 13-hour open case with no update at all is what keeps the section on the page.
  await expect(page.getByRole('link', { name: 'Open, no update for 12 h', exact: true })).toBeVisible()
})

test('each new drill-down lists exactly the seeded cases behind its row', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.105' : '198.51.100.106')
  await signIn(page, E2E_USERS.navigator)

  const drill = async (key: string) => {
    await page.goto(`/dashboard?drill=${encodeURIComponent(key)}`)
    await expect(page.locator('[data-drill-label]'), key).toHaveCount(1)
  }
  /** Present, and the named counter-example absent — the same shape the threshold test uses. */
  const listsOnly = async (key: string, present: string[], absent: string[]) => {
    await drill(key)
    for (const mrn of present) await expect(rowFor(page, mrn), `${key} lists ${mrn}`).not.toHaveCount(0)
    for (const mrn of absent) await expect(rowFor(page, mrn), `${key} omits ${mrn}`).toHaveCount(0)
  }

  // A stay band is the same arithmetic the threshold table does, sliced differently.
  expect(fixtureMrnsInBand(24, null)).toEqual(['3200001', '3200007', '3200008'])
  await listsOnly('stayband:24+ h', ['3200001', '3200007', '3200008'], ['3200002', '3200012'])
  await expect(page.locator('[data-drill-label]')).toHaveText('Stay 24+ h')

  // CTAS and the ED area, the two Slice D fields.
  await listsOnly('ctas:5', ['3200006', REPEAT_MRN], ['3200001'])
  await listsOnly('area:Resuscitation area', ['3200001', '3200007'], ['3200004'])

  // A working target drills to the cases that MISSED it: 3200002 decided 11.6 h after the
  // physician saw it, 3200001 after 1.5 h.
  await listsOnly('target:decision150', ['3200002', '3200003', '3200007'], ['3200001'])
  await expect(page.locator('[data-drill-label]')).toHaveText('Missed: Decision within 2 h 30 of physician contact')

  // The deck's "no operational action documented": 3200012 has no update, no escalation, no fax
  // and no transfer; 3200001 has all but the transfer.
  await listsOnly('action:No action documented', ['3200012'], ['3200001'])

  // Phase 10: the payer table and the phase split both drill down like every other row.
  await page.goto('/dashboard?drill=payer%3AGovernment')
  await expect(page.locator('[data-drill-label]')).toHaveText('Payer: Government')
  await expect(page.locator('a[data-mrn]').first()).toBeVisible()
  await page.goto('/dashboard?drill=phase%3Afront%7Cmedian')
  await expect(page.locator('[data-drill-label]')).toHaveText('Front end: cases with the interval measured')
  await listsOnly('action:External transfer / fax / RCC', ['3200010'], ['3200001'])

  // Adaa's treated-within bands, and an outcome.
  await listsOnly('treated:Within 4 h', ['3200006'], ['3200001'])
  await listsOnly('outcome:Discharged DAMA', ['3200005'], ['3200001'])

  // The two grid sections: CT ordered at 2 h with a preliminary read at 6 h is a 4-hour
  // turnaround; the ICU admission ordered at 3 h left the department 23 hours later.
  await listsOnly('turnaround:CT|2–4 h', ['3200002'], ['3200009'])
  await listsOnly('unitband:ICU|>4 h', ['3200001'], ['3200007'])

  // One MRN, two cases in range.
  await drill(`repeat:${REPEAT_MRN}`)
  await expect(page.locator('[data-drill-label]')).toHaveText(`MRN ${REPEAT_MRN}, 2 visits`)
  await expect(rowFor(page, REPEAT_MRN)).toHaveCount(2)
})

/**
 * Phase 8b, Slice H. One seeded case (`PHASE8B_MRN`) carries every collection decision, so each
 * new row on the page can be named rather than counted: the two Adaa KPI rows, the pain block
 * beside the pethidine doses, the seven action rows, the nine documentation rows, and the
 * discharge-communication section after Outcomes.
 */
test('the Phase 8b panels render, with the pain block and the discharge shares', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.109' : '198.51.100.110')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  // The Adaa panel's two new rows, named as the module names them.
  for (const kpi of ['KPI 7 · Mortality', 'KPI 8 · Door to painkiller, median']) {
    await expect(page.getByRole('cell', { name: kpi, exact: true }), kpi).toBeVisible()
  }
  // The rows are in the spec's order: KPI 4 is last, after the two new ones.
  const adaa = page.getByRole('heading', { name: 'Adaa KPIs, tracked cases only', exact: true }).locator('xpath=../table[1]')
  const names = await adaa.getByRole('row').evaluateAll((rows) =>
    rows.map((r) => (r.querySelector('td')?.textContent ?? '').trim()).filter(Boolean),
  )
  expect(names).toEqual([
    'KPI 1 · Door to doctor, median',
    'KPI 2 · Doctor to decision, median',
    'KPI 3 · Decision to disposition, median',
    'KPI 5 · Door to disposition within 4 h',
    'KPI 6 · Discharged DAMA',
    'KPI 7 · Mortality',
    'KPI 8 · Door to painkiller, median',
    'KPI 4 · CTAS 4 or 5',
  ])

  // The pain block: the four bands beside the three doses, with their denominators stated.
  const pain = page.locator('[data-pain-block]')
  await expect(pain).toBeVisible()
  await expect(pain).toContainText('Door to painkiller')
  await expect(pain).toContainText('prescribed')
  for (const band of ['≤30 min', '>30 min–1 h', '>1–3 h', '>3 h']) {
    await expect(pain.getByRole('link', { name: band, exact: true }), band).toBeVisible()
  }
  for (const dose of ['50 mg', '100 mg', '150 mg']) {
    await expect(pain.getByRole('link', { name: dose, exact: true }), dose).toBeVisible()
  }

  // "Actions documented" carries the module's seven kinds, the untagged row included.
  const actions = page.getByRole('heading', { name: 'Actions documented', exact: true }).locator('xpath=../table')
  for (const kind of [
    'Leadership escalation',
    'Case / bed management',
    'External transfer / fax / RCC',
    'PRO / social work',
    'Forced / safety admission',
    'DAMA management',
    'Update without an action tag',
  ]) {
    await expect(actions.getByRole('link', { name: kind, exact: true }), kind).toBeVisible()
  }

  // "Documentation" carries all nine checks, the three Phase 8b ones included.
  const documentation = page.getByRole('heading', { name: 'Documentation', exact: true }).locator('xpath=../table')
  for (const check of [
    'No delay reason recorded',
    'Open, no update for 12 h',
    'Open 24 h with no disposition decided',
    'Resolved without a disposition',
    'Times out of order',
    'Stay cannot be computed (leaving before registration)',
    'Resolved, not yet reviewed',
    'Painkiller prescribed, no time given recorded',
    'Pethidine prescribed, dose missing or not 50 / 100 / 150 mg',
  ]) {
    await expect(documentation.getByRole('link', { name: check, exact: true }), check).toBeVisible()
  }

  // The new section, and its place on the page: after Outcomes, before By CTAS.
  await expect(page.getByRole('heading', { name: 'Discharge communication', exact: true })).toBeVisible()
  const headings = await page.locator('.dash h3').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))
  expect(headings.indexOf('Discharge communication')).toBe(headings.indexOf('Outcomes') + 1)
  expect(headings.indexOf('By CTAS')).toBeGreaterThan(headings.indexOf('Discharge communication'))
  const communication = page.getByRole('heading', { name: 'Discharge communication', exact: true }).locator('xpath=../table')
  await expect(communication.getByRole('link', { name: 'Instructions given by doctor', exact: true })).toBeVisible()
  await expect(communication.getByRole('link', { name: 'Family engaged', exact: true })).toBeVisible()
  // Each row draws a share bar, which is the section's only chart.
  await expect(page.locator('[data-share="Instructions given by doctor"]')).toBeVisible()

  // Deceased is an outcome now, so it has a bar of its own.
  await expect(page.getByRole('link', { name: /^Deceased/ })).toHaveCount(1)
})

test('the Phase 8b drill-downs list the case that carries each row', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.111' : '198.51.100.112')
  await signIn(page, E2E_USERS.navigator)

  const listsOnly = async (key: string, present: string[], absent: string[]) => {
    await page.goto(`/dashboard?drill=${encodeURIComponent(key)}`)
    await expect(page.locator('[data-drill-label]'), key).toHaveCount(1)
    for (const mrn of present) await expect(rowFor(page, mrn), `${key} lists ${mrn}`).not.toHaveCount(0)
    for (const mrn of absent) await expect(rowFor(page, mrn), `${key} omits ${mrn}`).toHaveCount(0)
  }

  // The painkiller was given 45 minutes after registration, so it is in the second band and in
  // neither the first nor the last. 3200001 recorded no pain block at all.
  await listsOnly('painkiller:band|>30 min–1 h', [PHASE8B_MRN], ['3200001'])
  await expect(page.locator('[data-drill-label]')).toHaveText('Door to painkiller >30 min–1 h')
  await listsOnly('painkiller:band|≤30 min', [], [PHASE8B_MRN])
  await listsOnly('painkiller:dose|100 mg', [PHASE8B_MRN], ['3200001'])
  await expect(page.locator('[data-drill-label]')).toHaveText('Pethidine 100 mg')
  await listsOnly('painkiller:dose|50 mg', [], [PHASE8B_MRN])

  // One case answered each question; nobody else answered either.
  await listsOnly('communication:Instructions given by doctor', [PHASE8B_MRN], ['3200001'])
  await expect(page.locator('[data-drill-label]')).toHaveText('Instructions given by doctor: recorded')
  await listsOnly('communication:Family engaged', [PHASE8B_MRN], ['3200001'])

  // The two tagged updates, and the sixth action row, which no other fixture case earns.
  await listsOnly('action:PRO / social work', [PHASE8B_MRN], ['3200001'])
  // 3200001's escalation is a recorded time rather than a tag, so both cases are on this row.
  await listsOnly('action:Leadership escalation', [PHASE8B_MRN, '3200001'], ['3200012'])
  // An update with no category at all: 3200001 wrote two, this case wrote none.
  await listsOnly('action:Update without an action tag', ['3200001'], [PHASE8B_MRN])

  // The review mark: every other resolved fixture case is on the "not yet reviewed" row.
  await listsOnly('quality:Resolved, not yet reviewed', ['3200001'], [PHASE8B_MRN])

  // Decision E's disposition as an outcome.
  await listsOnly('outcome:Deceased', [PHASE8B_MRN], ['3200001'])
})

test('the longest stays table ranks the seeded 30-hour case and links to it', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.107' : '198.51.100.108')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  const table = page.getByRole('heading', { name: 'Longest stays', exact: true }).locator('xpath=../table')
  const links = table.getByRole('link')
  await expect(links.first()).toHaveAttribute('href', /^\/cases\/[a-z0-9]+$/)

  // 3200007 stayed 30 h, which is longer than anything else this suite seeds bar one open board
  // case, so it is always inside the ten. Its row carries its rank, its stay and its outcome.
  const row = table.getByRole('row').filter({ hasText: '3200007' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('30h 00m')
  await expect(row).toContainText('Admitted')

  // Ranked longest first: the numbers run 1, 2, 3, … down the first column.
  const ranks = await links.evaluateAll((els) => els.map((e) => Number((e.textContent ?? '').split('.')[0])))
  expect(ranks).toEqual(ranks.map((_, i) => i + 1))
})

/**
 * Phase 10, the filter. Every figure on the page is over the filtered population, because the
 * filter is applied to the loaded cases before `dashboard()` runs — so the check that matters is
 * that the headline moves with it and that the footnote says which filter moved it.
 *
 * The seed is the only source of a payer in this database (the other spec files' cases record
 * none), so a payer filter is the one narrowing whose result this file can name.
 */
test('the filter narrows every figure on the page, and the page says so', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.113' : '198.51.100.114')
  await signIn(page, E2E_USERS.navigator)

  await page.goto('/dashboard?r=all')
  await expect(page.locator('[data-filter-note]')).toHaveCount(0)
  const whole = await page.locator('[data-subtitle]').innerText()

  await page.goto('/dashboard?r=all&payer=SELF_PAY')
  await expect(page.locator('[data-filter-note]')).toHaveText('Filtered: Payer: Self-pay')
  const narrowed = await page.locator('[data-subtitle]').innerText()
  expect(narrowed).not.toBe(whole)
  // `total` narrows with everything else: "n of n cases", because the filter is the population.
  const [, inRange, total] = /^(\d+) of (\d+) cases$/.exec(narrowed) ?? []
  expect(Number(inRange)).toBe(Number(total))
  // The two seeded self-pay cases, and neither of the insured ones.
  expect(Number(total)).toBe(2)

  // The range chips and every drill link carry the filter, so a drill-down stays inside the
  // population its row was counted in.
  await expect(page.getByRole('link', { name: 'All time' })).toHaveAttribute('href', /payer=SELF_PAY/)
  await page.goto('/dashboard?r=all&payer=SELF_PAY&drill=payer%3ASelf-pay')
  await expect(page.locator('[data-drill-label]')).toHaveText('Payer: Self-pay')
  await expect(rowFor(page, '3200005')).toHaveCount(1)
  await expect(rowFor(page, '3200009')).toHaveCount(1)
  await expect(rowFor(page, '3200001')).toHaveCount(0)
  // …and back to the filtered dashboard, not the whole department.
  await expect(page.getByRole('link', { name: '‹ Dashboard' })).toHaveAttribute('href', /payer=SELF_PAY/)

  // "Where the time goes" and "By payer" still draw over the filtered population.
  await page.goto('/dashboard?r=all&payer=SELF_PAY')
  await expect(page.getByRole('heading', { name: 'Where the time goes', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'By payer', exact: true })).toBeVisible()
  // The three payers always have a row; what the filter changes is the count in it. Government
  // has four seeded cases and Insured four, and under this filter both read zero.
  const byPayer = page.getByRole('heading', { name: 'By payer', exact: true }).locator('xpath=../table')
  const payerCases = (label: string) =>
    byPayer.getByRole('row').filter({ hasText: label }).getByRole('cell').nth(1)
  await expect(payerCases('Self-pay')).toHaveText('2')
  await expect(payerCases('Insured')).toHaveText('0')
  await expect(payerCases('Government')).toHaveText('0')
})

/**
 * Phase 10 review. The test above reaches its drill-down by `goto`, so a row link that dropped the
 * filter went unnoticed. Two builders make those links: DashboardBody's own (thresholds, weeks,
 * consults, investigations, shifts) and sections.tsx's (every other table), so a row of each is
 * read, then clicked. The filter repeats a key and spans two dimensions, and it leaves 3200008 and
 * 3200009 of the fixture, so both lists below differ from their unfiltered ones.
 */
test('a filtered dashboard’s rows open their drill-downs inside the same filter', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.215' : '198.51.100.216')
  await signIn(page, E2E_USERS.navigator)
  const query = 'r=all&ctas=3&payer=SELF_PAY&payer=GOVERNMENT'
  await page.goto(`/dashboard?${query}`)
  await expect(page.locator('[data-filter-note]')).toHaveText('Filtered: CTAS 3 · Payer: Self-pay or Government')

  /** The row link's own href, held to the range, its drill key and every filter key and value. */
  const hrefOf = async (link: Locator, drill: string): Promise<string> => {
    const href = (await link.getAttribute('href')) ?? ''
    const params = new URL(href, 'http://dashboard.invalid').searchParams
    expect(params.get('r'), href).toBe('all')
    expect(params.get('drill'), href).toBe(drill)
    expect(params.getAll('ctas'), href).toEqual(['3'])
    expect(params.getAll('payer'), href).toEqual(['SELF_PAY', 'GOVERNMENT'])
    return href
  }
  const back = page.getByRole('link', { name: '‹ Dashboard' })

  // A sections.tsx row. Of the two self-pay fixture cases only 3200009 is CTAS 3.
  const byPayer = page.getByRole('heading', { name: 'By payer', exact: true }).locator('xpath=../table')
  const selfPay = byPayer.getByRole('link', { name: 'Self-pay', exact: true })
  const payerHref = await hrefOf(selfPay, 'payer:Self-pay')
  await selfPay.click()
  await expect(page).toHaveURL(payerHref)
  await expect(page.locator('[data-drill-label]')).toHaveText('Payer: Self-pay')
  await expect(rowFor(page, '3200009')).toHaveCount(1)
  await expect(rowFor(page, '3200005')).toHaveCount(0)
  await expect(back).toHaveAttribute('href', `/dashboard?${query}`)
  await back.click()
  await expect(page).toHaveURL(`/dashboard?${query}`)

  // A DashboardBody row. Past six hours, CTAS 3 and not insured: 3200008 (26 h) and 3200009 (13 h);
  // 3200001 (26 h) is CTAS 2, 3200002 (14 h) insured, and 3200005 stayed 5 h.
  const over6 = page.getByRole('link', { name: 'Over 6h' })
  const thresholdHref = await hrefOf(over6, 'threshold:6')
  await over6.click()
  await expect(page).toHaveURL(thresholdHref)
  await expect(page.locator('[data-drill-label]')).toHaveText('Cases over 6h')
  for (const mrn of ['3200008', '3200009']) await expect(rowFor(page, mrn), `${mrn} is listed`).toHaveCount(1)
  for (const mrn of ['3200001', '3200002', '3200005']) {
    await expect(rowFor(page, mrn), `${mrn} is outside the filter`).toHaveCount(0)
  }
  await expect(back).toHaveAttribute('href', `/dashboard?${query}`)
})

test('the filter panel applies from the dashboard itself', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.115' : '198.51.100.116')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard?r=7')

  await page.getByRole('button', { name: 'Filter' }).click()
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  await panel.getByRole('group', { name: 'Payer' }).getByRole('button', { name: 'Insured' }).click()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  // The range survives the apply, and the filter is appended after it.
  await expect(page).toHaveURL('/dashboard?r=7&payer=INSURED')
  await expect(page.locator('[data-filter-note]')).toHaveText('Filtered: Payer: Insured')

  // Escape closes the panel without changing anything.
  await page.getByRole('button', { name: /^Filter/ }).click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page).toHaveURL('/dashboard?r=7&payer=INSURED')

  // The two modes, which no browser test had pressed (Phase 10 review): a stage — a set a case can
  // carry several of, which the lone finding holds to exactly — excluded, and alone.
  await page.goto('/dashboard?r=7')
  await page.getByRole('button', { name: 'Filter' }).click()
  await panel.getByRole('group', { name: 'Stage' }).getByRole('button', { name: 'Admission process' }).click()
  await panel.getByRole('button', { name: 'Exclude', exact: true }).click()
  await panel.getByRole('button', { name: 'The lone finding', exact: true }).click()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page).toHaveURL('/dashboard?r=7&stage=adm&not=1&lone=1')
  // describeFilter's sentence for one dimension: "Excluding <part> · the lone finding".
  await expect(page.locator('[data-filter-note]')).toHaveText(
    'Filtered: Excluding Stage: Admission process · the lone finding',
  )
  // Opened again, the panel shows the modes the page is drawn with.
  await page.getByRole('button', { name: /^Filter/ }).click()
  await expect(panel.getByRole('button', { name: 'Exclude', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: 'The lone finding', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

/**
 * Phase 10 review. The seed gives every stage a reason named "Other", and the filter keys a
 * reason by its name — `reason=Other` matches an Other under any stage, as "By primary reason"
 * counts it as one row. The panel used to offer it under each of the ten stages, and tapping any
 * one lit all ten. It is one value, so it is one chip, in its own "Any stage" group after the
 * stages. The team called "Other" and the outcome called "Other" are other dimensions.
 */
test('the panel offers "Other" once, under "Any stage", and it presses one chip', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.211' : '198.51.100.212')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard?r=all')

  await page.getByRole('button', { name: 'Filter' }).click()
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  const reasons = panel.getByRole('group', { name: 'Reason', exact: true })
  const other = reasons.getByRole('button', { name: 'Other', exact: true })
  await expect(other).toHaveCount(1)

  // Under "Any stage", which is the last of the reason sub-groups, after every stage's own.
  const anyStage = reasons.locator('[data-reasons-any-stage]')
  await expect(anyStage.getByRole('button', { name: 'Other', exact: true })).toHaveCount(1)
  const captions = await reasons.evaluate((group) =>
    [...group.children]
      .filter((child) => child.tagName === 'DIV')
      .map((child) => (child.querySelector('span')?.textContent ?? '').trim()),
  )
  expect(captions.length, 'a sub-group per stage, then "Any stage"').toBeGreaterThan(1)
  expect(captions.at(-1)).toBe('Any stage')
  expect(captions.slice(0, -1)).not.toContain('Any stage')

  // One tap, one chip.
  await other.click()
  await expect(other).toHaveAttribute('aria-pressed', 'true')
  await expect(reasons.locator('[aria-pressed="true"]')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page).toHaveURL('/dashboard?r=all&reason=Other')
  await expect(page.locator('[data-filter-chip="Reason: Other"]')).toBeVisible()
})

/**
 * A point over `selector` that the phone's filter sheet leaves uncovered, where `elementFromPoint`
 * is the dim and the stack beneath it holds `selector`: the tap is proven to land on the dim, over
 * the control a ghost click would hit, so a green run cannot mean the tap simply missed.
 */
async function dimPointOver(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const target = await page.locator(selector).first().boundingBox()
  const sheet = await page.locator('[data-filter-panel]').boundingBox()
  const viewport = page.viewportSize()
  if (!target || !sheet || !viewport) throw new Error(`no geometry for ${selector}, the sheet or the viewport`)
  const inSheet = (x: number, y: number): boolean =>
    x >= sheet.x && x <= sheet.x + sheet.width && y >= sheet.y && y <= sheet.y + sheet.height
  for (const fy of [0.5, 0.25, 0.75]) {
    for (const fx of [0.5, 0.3, 0.7, 0.1, 0.9]) {
      const x = Math.round(target.x + target.width * fx)
      const y = Math.round(target.y + target.height * fy)
      if (x < 1 || y < 1 || x >= viewport.width - 1 || y >= viewport.height - 1 || inSheet(x, y)) continue
      const hit = await page.evaluate(
        ({ x, y, selector }) => ({
          dim: document.elementFromPoint(x, y)?.hasAttribute('data-filter-dim') ?? false,
          over: document.elementsFromPoint(x, y).some((element) => element.closest(selector) !== null),
        }),
        { x, y, selector },
      )
      if (hit.dim && hit.over) return { x, y }
    }
  }
  throw new Error(`no point over ${selector} is left to the dim by the sheet`)
}

/**
 * Phase 10 review. On a phone the filter panel is a bottom sheet over a dim, and the dim covers the
 * Filter button, the chips' × and "Clear filter". The panel used to close on the press: React took
 * the dim away with the finger still down, and the click the browser makes after touchend was
 * hit-tested afresh onto whatever the dim had covered — the panel opened again, a chip was dropped,
 * the filter was cleared. The dim now closes the panel from its own click. The laptop's popover
 * has no dim, and a press outside it still closes it.
 */
test('a tap on the filter dim closes the panel and changes nothing under it', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.213' : '198.51.100.214')
  await signIn(page, E2E_USERS.navigator)
  const filtered = '/dashboard?r=all&payer=SELF_PAY'
  await page.goto(filtered)
  const toggle = page.locator('[data-filter-toggle]')
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  const chipLabels = () =>
    page.locator('[data-filter-chip]').evaluateAll((els) => els.map((el) => el.getAttribute('data-filter-chip')))
  await expect(page.locator('[data-filter-chip]')).toHaveCount(1)
  const chips = await chipLabels()

  if (!mobile) {
    await toggle.click()
    await expect(panel).toBeVisible()
    await expect(page.locator('[data-filter-dim]')).toBeHidden()
    await page.getByRole('heading', { name: 'Dashboard' }).click()
    await expect(panel).toHaveCount(0)
    await expect(page).toHaveURL(filtered)
    expect(await chipLabels()).toEqual(chips)
    return
  }

  // The bar to the top of the screen, where the sheet (at most 80 % of it) leaves only the dim.
  await page.locator('[data-filter-bar]').evaluate((element) => element.scrollIntoView({ block: 'start' }))
  // Every click from here on, by what it landed on: "dim", or the control's name.
  await page.evaluate(() => {
    const landed: string[] = []
    Object.assign(window, { __filterClicks: landed })
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element
        const control = target.closest('button, a')
        landed.push(
          target.hasAttribute('data-filter-dim')
            ? 'dim'
            : (control?.getAttribute('aria-label') ?? control?.textContent ?? target.tagName.toLowerCase()),
        )
      },
      { capture: true },
    )
  })
  type Recorded = { __filterClicks: string[] }
  const clicks = () => page.evaluate(() => [...(window as unknown as Recorded).__filterClicks])
  const forgetClicks = () => page.evaluate(() => void (window as unknown as Recorded).__filterClicks.splice(0))

  for (const [what, selector] of [
    ['the Filter button', '[data-filter-toggle]'],
    ['a chip’s ×', '[data-filter-chip] button'],
    ['Clear filter', '[data-filter-clear]'],
  ] as const) {
    await toggle.click()
    await expect(panel, what).toBeVisible()
    await forgetClicks()
    const point = await dimPointOver(page, selector)
    await page.touchscreen.tap(point.x, point.y)

    await expect(panel, `a tap on the dim over ${what} closes the panel`).toHaveCount(0)
    // The tap's one click was the dim's, not the control's under it...
    await expect.poll(clicks, what).toEqual(['dim'])
    // ...so the page is the same filtered dashboard, and the keyboard is back on the button.
    expect(page.url(), what).toMatch(/\/dashboard\?r=all&payer=SELF_PAY$/)
    expect(await chipLabels(), what).toEqual(chips)
    await expect(toggle, what).toBeFocused()
  }
})

/**
 * A filter that matches nothing empties every section, and the page must then say it was the
 * FILTER that found nothing: "No cases yet." under a filter reads as an empty department. A stage
 * code nothing carries is also what a link to a stage an Admin has since deactivated looks like.
 */
test('a filter that matches nothing says so, rather than "No cases yet."', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.162' : '198.51.100.163')
  await signIn(page, E2E_USERS.navigator)

  await page.goto('/dashboard?stage=zzz-no-such-stage')
  await expect(page.getByText('No case in this range matches this filter.', { exact: true })).toBeVisible()
  await expect(page.getByText('No cases yet.')).toHaveCount(0)
  // The footnote still names the filter that emptied the page, so the reader knows what to drop.
  await expect(page.locator('[data-filter-note]')).toHaveText('Filtered: Stage: zzz-no-such-stage')
})

/**
 * Phase 11. Every payer at once is the fixture and nothing else — no other spec file records a
 * payer — so the figures below can be named. Its twelve cases with a payer are 3200001–3200010,
 * 3200012 and 3200013 (the repeat MRN records none).
 */
const FIXTURE_ONLY = 'r=all&payer=GOVERNMENT&payer=INSURED&payer=SELF_PAY'

/** Where the centre of `mark` sits across `track`, from 0 at its left edge to 1 at its right. */
async function across(mark: Locator, track: Locator): Promise<number> {
  const [m, t] = await Promise.all([mark.boundingBox(), track.boundingBox()])
  if (!m || !t) throw new Error('no geometry for the marker or its track')
  return (m.x + m.width / 2 - t.x) / t.width
}

/**
 * Item 1. Door to doctor over the ten fixture cases with a physician time is 18, 24, 24, 30, 30,
 * 30, 30, 36, 60 and 60 minutes: a median of 30, "needs improvement", halfway along a track that
 * ends at 60. Two of the eight resolved cases left within four hours, so KPI 5 is 25 %,
 * unacceptable, and — the scale running from 100 % on the left — three quarters of the way along.
 * One case records a painkiller, so KPI 8 is a track with no marker.
 */
test('the Adaa KPIs sit against their four tiers, with the table still under them', async ({ page }) => {
  await fromClientIp(page, '198.51.100.241')
  await signIn(page, E2E_USERS.navigator)
  await page.goto(`/dashboard?${FIXTURE_ONLY}`)

  const heading = page.getByRole('heading', { name: 'Adaa KPIs, tracked cases only', exact: true })
  const adaa = heading.locator('xpath=..')
  const bullets = adaa.locator('[data-bullet]')
  expect(await bullets.evaluateAll((els) => els.map((e) => e.getAttribute('data-bullet')))).toEqual([
    'kpi1',
    'kpi2',
    'kpi3',
    'kpi5',
    'kpi8',
    'kpi4',
  ])

  const kpi1 = adaa.locator('[data-bullet="kpi1"]')
  await expect(kpi1).toContainText('KPI 1 · Door to doctor, median')
  await expect(kpi1).toContainText('30 min')
  await expect(kpi1).toContainText('needs improvement')
  await expect(kpi1.locator('[data-tier]')).toHaveCount(4)
  expect(await kpi1.locator('[data-tier]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tier')))).toEqual([
    'world',
    'acceptable',
    'improve',
    'unacceptable',
  ])
  // Only the value's tier is shaded, and the marker sits at 30 of 60 minutes.
  await expect(kpi1.locator('[data-current]')).toHaveAttribute('data-tier', 'improve')
  expect(await across(kpi1.locator('[data-marker]'), kpi1.locator('[data-track]'))).toBeCloseTo(0.5, 1)

  const kpi5 = adaa.locator('[data-bullet="kpi5"]')
  await expect(kpi5).toContainText('25%')
  await expect(kpi5).toContainText('unacceptable')
  await expect(kpi5.locator('[data-current]')).toHaveAttribute('data-tier', 'unacceptable')
  expect(await across(kpi5.locator('[data-marker]'), kpi5.locator('[data-track]'))).toBeCloseTo(0.75, 1)

  // Below three cases: the track, "n<3" and no marker.
  const kpi8 = adaa.locator('[data-bullet="kpi8"]')
  await expect(kpi8).toContainText('n<3')
  await expect(kpi8.locator('[data-tier]')).toHaveCount(4)
  await expect(kpi8.locator('[data-marker]')).toHaveCount(0)
  await expect(kpi8.locator('[data-current]')).toHaveCount(0)

  // The table is still there, still the section's first table, and says the same.
  const table = heading.locator('xpath=../table[1]')
  await expect(table.getByRole('row', { name: /^KPI 1 · Door to doctor, median/ })).toContainText('30 min')
})

/**
 * Items 2 and 7. Seven fixture cases with a payer were resolved with all three phases measured —
 * front end, decision, after the decision, in hours:
 *
 *   admitted    3200001 (0.5, 1.5, 24)  3200003 (1, 5, 3)  3200007 (0.6, 7.4, 22)   2.1, 13.9, 49 of 65
 *   discharged  3200002 (0.4, 11.6, 2)  3200004 (0.3, 3.7, 3)  3200005 (0.5, 1.5, 3)  1.2, 16.8, 8 of 26
 *   other       3200013, deceased (0.4, 0.6, 1)
 *
 * so all seven split 3.7, 31.3 and 58 of 93 hours (4 %, 34 %, 62 %), the admitted 3 %, 21 % and
 * 75 %, the discharged 5 %, 65 % and 31 %; "other" has one case and is not drawn.
 */
test('the stay splits overall and by outcome, and a stage with no case is left out', async ({ page }) => {
  await fromClientIp(page, '198.51.100.242')
  await signIn(page, E2E_USERS.navigator)
  await page.goto(`/dashboard?${FIXTURE_ONLY}`)

  const section = page.getByRole('heading', { name: 'Where the time goes', exact: true }).locator('xpath=..')
  const split = section.locator('[data-chart="stay-split"]')
  await expect(split).toContainText('over the 7 cases with all three measured')
  expect(await split.locator('[data-split]').evaluateAll((els) => els.map((e) => e.getAttribute('data-split')))).toEqual([
    'all',
    'admitted',
    'discharged',
  ])

  const bar = (key: string) => split.locator(`[data-split="${key}"]`)
  await expect(bar('all')).toContainText('All outcomes')
  // Each segment's own item, in order: a whole-bar toContainText('4%') is satisfied by '34%'.
  const items = (key: string) => bar(key).locator('ul.num > li')
  await expect(items('all')).toHaveText(['Front end: 4% · 0h 30m', 'Decision: 34% · 3h 42m', 'After the decision: 62% · 3h 00m'])
  await expect(bar('admitted')).toContainText('Admitted')
  await expect(bar('admitted')).toContainText('3 cases')
  for (const text of ['3%', '21%', '75%', '22h 00m']) await expect(bar('admitted')).toContainText(text)
  await expect(items('discharged')).toHaveText([/^Front end: 5% · /, /^Decision: 65% · /, /^After the decision: 31% · /])

  // Three segments in time order, to scale: after the decision is three quarters of the admitted bar.
  const segments = bar('admitted').locator('[data-segment]')
  expect(await segments.evaluateAll((els) => els.map((e) => e.getAttribute('data-segment')))).toEqual([
    'front',
    'decision',
    'after',
  ])
  const [after, whole] = await Promise.all([
    bar('admitted').locator('[data-segment="after"]').boundingBox(),
    bar('admitted').locator('[data-bar]').boundingBox(),
  ])
  expect(after!.width / whole!.width).toBeCloseTo(0.75, 1)

  // Item 7: only the stages with a case. The fixture's front-end reasons are one registration and
  // one triage delay, so resus and exam room are gone; no case waits on the disposition decision or
  // on administration.
  const stages = (phase: string) => section.locator(`[data-phase-stages="${phase}"]`)
  await expect(stages('front').getByRole('link', { name: 'Registration', exact: true })).toBeVisible()
  await expect(stages('front').getByRole('link', { name: 'Triage', exact: true })).toBeVisible()
  await expect(stages('front').getByRole('link')).toHaveCount(2)
  await expect(stages('decision').getByRole('link', { name: 'Disposition decision', exact: true })).toHaveCount(0)
  await expect(stages('after').getByRole('link', { name: 'Administrative / coordination', exact: true })).toHaveCount(0)

  // A phase with none says so: the admission-process cases carry no reason before the decision.
  await page.goto(`/dashboard?${FIXTURE_ONLY}&stage=adm`)
  await expect(stages('front')).toContainText('No case in this range carries one.')
  await expect(stages('front').getByRole('table')).toHaveCount(0)
  await expect(stages('after').getByRole('link', { name: 'Admission process', exact: true })).toBeVisible()
})

/** The Asia/Riyadh calendar day of an instant, `YYYY-MM-DD` (en-CA writes dates that way round). */
const riyadhDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )

/** A seeded case's registration instant, read off the board API rather than guessed from the clock. */
async function registeredAt(page: Page, mrn: string): Promise<string> {
  const response = await page.request.get('/api/board?f=all')
  const payload = (await response.json()) as BoardPayload
  const row = payload.rows.find((r) => r.mrn === mrn)
  if (!row) throw new Error(`${mrn} is not on the board`)
  return row.registrationAt
}

/**
 * Item 3. On the seven- and thirty-day ranges the weekly chart gives way to one bar per Riyadh
 * day — eight bars and thirty-one, because the window is the last N x 24 hours and opens part way
 * through a day — with a 6 h line on the median panel. Each day with a case is a drill-down.
 */
test('the last days are drawn by day, with a 6 h line, and each day drills to its cases', async ({ page }) => {
  await fromClientIp(page, '198.51.100.243')
  await signIn(page, E2E_USERS.navigator)

  const byDay = page.getByRole('heading', { name: 'By day: cases and median stay', exact: true })
  const byWeek = page.getByRole('heading', { name: 'By week: cases and median stay', exact: true })
  for (const [query, days] of [
    ['', 31],
    ['?r=7', 8],
  ] as const) {
    await page.goto(`/dashboard${query}`)
    await expect(byDay, query).toBeVisible()
    await expect(byWeek, query).toHaveCount(0)
    const chart = page.locator('[data-chart="daily"]')
    await expect(chart).toHaveAttribute('data-points', String(days))
    await expect(chart.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
    await expect(chart.locator('[data-chart-panel="median"] .recharts-reference-line')).toHaveCount(1)
    await expect(chart.locator('[data-chart-panel="median"]')).toContainText('6 h')
    // The two panels share their days: every date label stays inside the chart, and a median dot
    // sits over its own day's bar (a line alone would get a point scale and drift off the bars).
    const geometry = await chart.evaluate((el) => {
      const median = el.querySelector('[data-chart-panel="median"] svg')!
      const box = median.getBoundingClientRect()
      const labels = [...median.querySelectorAll('text')].filter((t) => /\d\d\/\d\d/.test(t.textContent ?? ''))
      const bars = [...el.querySelectorAll('[data-chart-panel="cases"] .recharts-bar-rectangle')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.left + r.width / 2)
      return {
        overflow: Math.max(...labels.map((t) => t.getBoundingClientRect().right - box.right)),
        dots: [...median.querySelectorAll('circle')].map((c) => {
          const r = c.getBoundingClientRect()
          return Math.min(...bars.map((x) => Math.abs(x - (r.left + r.width / 2))))
        }),
      }
    })
    expect(geometry.overflow, `${query}: a date label runs past the chart`).toBeLessThanOrEqual(0)
    for (const offset of geometry.dots) expect(offset, `${query}: a median dot is off its bar`).toBeLessThan(2)
  }
  // Ninety days and all time keep the weekly chart.
  for (const query of ['?r=90', '?r=all']) {
    await page.goto(`/dashboard${query}`)
    await expect(byWeek, query).toBeVisible()
    await expect(byDay, query).toHaveCount(0)
  }

  // A day's drill-down, reached from the link list, inside the filter the page is drawn with.
  // 3200008 is a Government case registered twenty-six hours ago; 3200009, self-pay, is not listed.
  const day = riyadhDate(await registeredAt(page, '3200008'))
  await page.goto('/dashboard?payer=GOVERNMENT')
  const link = page.locator(`[data-chart="daily"] ~ ul a[href*="drill=day%3A${day}"]`)
  await expect(link).toHaveCount(1)
  const href = (await link.getAttribute('href')) ?? ''
  expect(new URL(href, 'http://dashboard.invalid').searchParams.getAll('payer')).toEqual(['GOVERNMENT'])
  await page.goto(href)
  await expect(page.locator('[data-drill-label]')).toHaveText(
    new RegExp(`^Registered on (Sun|Mon|Tue|Wed|Thu|Fri|Sat) ${day.slice(8, 10)}/${day.slice(5, 7)}$`),
  )
  await expect(rowFor(page, '3200008')).toHaveCount(1)
  await expect(rowFor(page, '3200009')).toHaveCount(0)

  // And a bar is a way in too: the tallest bar of the week opens its own day.
  await page.goto('/dashboard?r=7')
  const bars = page.locator('[data-chart="daily"] [data-chart-panel="cases"] .recharts-bar-rectangle')
  await expect(bars.first()).toBeVisible()
  const heights = await bars.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
  await bars.nth(heights.indexOf(Math.max(...heights))).click()
  await expect(page).toHaveURL(/[?&]drill=day%3A\d{4}-\d{2}-\d{2}/)
  await expect(page.locator('[data-drill-label]')).toHaveText(/^Registered on /)
})

const WEEKDAYS: Record<string, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
}

/** The Riyadh weekday ("Mon") and three-hour block ("12–15") an instant falls in. */
function arrivalOf(iso: string): { weekday: string; block: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const start = Math.floor(hour / 3) * 3
  const pad = (n: number) => String(n).padStart(2, '0')
  return { weekday: parts.find((p) => p.type === 'weekday')!.value, block: `${pad(start)}–${pad(start + 3)}` }
}

/**
 * Item 4. A real table: Sunday to Saturday down, eight three-hour blocks across, a count in every
 * cell and a link in every cell with a case. The cell is found from the case's own registration
 * instant, so the test holds whatever time of day the suite runs.
 */
test('arrivals are a weekday-by-block table whose cells open their cases', async ({ page }) => {
  await fromClientIp(page, '198.51.100.244')
  await signIn(page, E2E_USERS.navigator)
  const { weekday, block } = arrivalOf(await registeredAt(page, '3200008'))
  await page.goto('/dashboard?payer=GOVERNMENT')

  const table = page.getByRole('heading', { name: 'Arrivals by day and time', exact: true }).locator('xpath=../table')
  await expect(table).toHaveCount(1)
  expect(await table.locator('thead th').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual([
    'Day',
    '00–03',
    '03–06',
    '06–09',
    '09–12',
    '12–15',
    '15–18',
    '18–21',
    '21–24',
  ])
  expect(await table.locator('tbody th').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))).toEqual([
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ])
  // Fifty-six cells, a count in each; the empty ones plain and not links, the rest filled and links.
  await expect(table.locator('tbody td')).toHaveCount(56)
  await expect(table.locator('td[data-count="0"] a')).toHaveCount(0)
  await expect(table.locator('td[data-count="0"][data-step]')).toHaveCount(0)
  const filled = await table.locator('td:not([data-count="0"])').count()
  expect(filled).toBeGreaterThan(0)
  await expect(table.locator('td:not([data-count="0"]) a')).toHaveCount(filled)
  await expect(page.locator('[data-heat-legend]')).toBeVisible()

  // 3200008's own cell, named in full, carrying the page's filter.
  const hours = `${block.slice(0, 2)}:00 to ${block.slice(3, 5)}:00`
  const cell = table.getByRole('link', { name: new RegExp(`^${WEEKDAYS[weekday]} ${hours}: \\d+ cases?$`) })
  await expect(cell).toHaveCount(1)
  const href = (await cell.getAttribute('href')) ?? ''
  const params = new URL(href, 'http://dashboard.invalid').searchParams
  expect(params.get('drill')).toBe(`arrival:${weekday}|${block}`)
  expect(params.getAll('payer')).toEqual(['GOVERNMENT'])
  await cell.click()
  await expect(page.locator('[data-drill-label]')).toHaveText(`Arrivals on ${WEEKDAYS[weekday]}s, ${hours}`)
  await expect(rowFor(page, '3200008')).toHaveCount(1)
  await expect(rowFor(page, '3200009')).toHaveCount(0)
})

/**
 * Item 6. The horizontal bar sections are rows of links with the whole label — above the bar on a
 * phone, beside it on a laptop — where the chart used to cut a reason at 22 characters
 * ("Awaiting consulted te…"). 3200003 is the one fixture case waiting on a consulted team.
 */
test('the bar sections show whole labels and stay links to their cases', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, '198.51.100.245')
  await signIn(page, E2E_USERS.navigator)
  await page.goto(`/dashboard?${FIXTURE_ONLY}`)

  const primary = page.getByRole('heading', { name: 'Primary delay reason', exact: true }).locator('xpath=..')
  const row = primary.getByRole('link', { name: /^Awaiting consulted team response\/callback: 1 case$/ })
  await expect(row).toBeVisible()
  await expect(row.locator('[data-bar-label]')).toHaveText('Awaiting consulted team response/callback')
  // Nothing is cut, and nothing is clipped by its own box.
  await expect(primary.getByText('…')).toHaveCount(0)
  for (const title of ['Primary delay reason', 'Pathways', 'Departments involved', 'Outcomes', 'By day of week']) {
    const labels = page.getByRole('heading', { name: title, exact: true }).locator('xpath=..').locator('[data-bar-label]')
    expect(await labels.count(), title).toBeGreaterThan(0)
    const clipped = await labels.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length)
    expect(clipped, `${title}: a label is clipped`).toBe(0)
  }

  // Above the bar on a phone; beside it, on the same line, on a laptop.
  const [label, bar] = await Promise.all([
    row.locator('[data-bar-label]').boundingBox(),
    row.locator('[data-bar-fill]').boundingBox(),
  ])
  if (!label || !bar) throw new Error('no geometry for the label or its bar')
  if (mobile) {
    expect(label.y + label.height).toBeLessThanOrEqual(bar.y + 1)
  } else {
    expect(label.x + label.width).toBeLessThanOrEqual(bar.x + 1)
    expect(bar.y).toBeLessThan(label.y + label.height)
    expect(bar.y + bar.height).toBeGreaterThan(label.y)
  }

  // Every bar section is drawn this way now, and no longer as an SVG chart.
  await expect(page.locator('[data-chart="hbar"]')).toHaveCount(6)
  await expect(page.locator('[data-chart="hbar"] svg')).toHaveCount(0)

  // The row is the drill-down, inside the filter the page is drawn with.
  const href = (await row.getAttribute('href')) ?? ''
  const params = new URL(href, 'http://dashboard.invalid').searchParams
  expect(params.get('drill')).toBe('primary:Awaiting consulted team response/callback')
  expect(params.getAll('payer')).toEqual(['GOVERNMENT', 'INSURED', 'SELF_PAY'])
  await row.click()
  await expect(page.locator('[data-drill-label]')).toHaveText('Awaiting consulted team response/callback')
  await expect(rowFor(page, '3200003')).toHaveCount(1)
})

/**
 * Items 5 and 7, the layout. The screen groups its sections — overview, time, reasons, KPIs,
 * teams, outcomes, quality — so that a phone's jump chips can land on the first section of each;
 * the report keeps its own order, the arrivals table placed after "By day of week". Every section
 * below is one the fixture earns, so both lists are the whole page. The "Other" queue's heading
 * carries a count, which is read as "(n)".
 */
const SCREEN_ORDER = [
  'Cases past each threshold',
  'Stay bands',
  'Where the time goes',
  'By day: cases and median stay',
  'Arrivals by day and time',
  'By shift',
  'By day of week',
  'Primary delay reason',
  'Pathways',
  'Departments involved',
  'Adaa KPIs, tracked cases only',
  'Working targets',
  'Admission to unit',
  'Turnaround: order to result',
  'Exam to consult, median',
  'Consulted team response, median',
  'Investigation turnaround, median from order',
  'Admission chain, median',
  'Longest stays',
  'Actions documented',
  'Outcomes',
  'Discharge communication',
  'By CTAS',
  'By ED area',
  'By payer',
  'Repeat visits',
  'Documentation',
  'Other reasons awaiting review (n)',
]
const REPORT_ORDER = [
  'Stay bands',
  'Adaa KPIs, tracked cases only',
  'Working targets',
  'Where the time goes',
  'Cases past each threshold',
  'By week: cases and median stay',
  'Primary delay reason',
  'Pathways',
  'Departments involved',
  'Admission to unit',
  'Turnaround: order to result',
  'Exam to consult, median',
  'Consulted team response, median',
  'Investigation turnaround, median from order',
  'Admission chain, median',
  'Longest stays',
  'Actions documented',
  'By shift',
  'By day of week',
  'Arrivals by day and time',
  'Outcomes',
  'Discharge communication',
  'By CTAS',
  'By ED area',
  'By payer',
  'Repeat visits',
  'Documentation',
  'Other reasons awaiting review (n)',
]
const headingsOf = (page: Page): Promise<string[]> =>
  page
    .locator('.dash h3')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().replace(/\(\d+\)$/, '(n)')))

test('the dashboard is two columns on a laptop and jumps by group on a phone; the report keeps its order', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, '198.51.100.246')
  // A viewer: the dashboard, and the printable report, and nothing to change on either.
  await signIn(page, E2E_USERS.viewer)
  await page.goto('/dashboard')
  expect(await headingsOf(page)).toEqual(SCREEN_ORDER)

  // Each group's anchor opens on its first section.
  for (const [id, first] of [
    ['dash-overview', 'Cases past each threshold'],
    ['dash-time', 'Where the time goes'],
    ['dash-reasons', 'Primary delay reason'],
    ['dash-kpis', 'Adaa KPIs, tracked cases only'],
    ['dash-teams', 'Turnaround: order to result'],
    ['dash-outcomes', 'Longest stays'],
    ['dash-quality', 'Documentation'],
  ] as const) {
    await expect(page.locator(`#${id} h3`).first(), id).toHaveText(first)
  }

  // The chips: a phone's, not a laptop's, and never on paper.
  const jump = page.getByRole('navigation', { name: 'Jump to a section' })
  if (mobile) {
    await expect(jump).toBeVisible()
    expect(
      await jump.getByRole('link').evaluateAll((els) => els.map((e) => [(e.textContent ?? '').trim(), e.getAttribute('href')])),
    ).toEqual([
      ['Overview', '#dash-overview'],
      ['Time', '#dash-time'],
      ['Reasons', '#dash-reasons'],
      ['KPIs', '#dash-kpis'],
      ['Teams', '#dash-teams'],
      ['Outcomes', '#dash-outcomes'],
      ['Quality', '#dash-quality'],
    ])
    await jump.getByRole('link', { name: 'KPIs', exact: true }).click()
    await expect(page).toHaveURL(/#dash-kpis$/)
    const adaa = page.getByRole('heading', { name: 'Adaa KPIs, tracked cases only', exact: true })
    await expect.poll(() => adaa.evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBeLessThan(120)
    expect(await adaa.evaluate((e) => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  } else {
    await expect(jump).toBeHidden()
  }

  // Short sections pair up side by side from lg; the wide ones run across both columns.
  const box = async (title: string) => {
    const b = await page.getByRole('heading', { name: title, exact: true }).locator('xpath=..').boundingBox()
    if (!b) throw new Error(`no box for "${title}"`)
    return b
  }
  const primary = await box('Primary delay reason')
  const pathways = await box('Pathways')
  const adaa = await box('Adaa KPIs, tracked cases only')
  const longest = await box('Longest stays')
  if (mobile) {
    expect(pathways.x).toBeCloseTo(primary.x, 0)
    expect(pathways.y).toBeGreaterThanOrEqual(primary.y + primary.height)
    expect(adaa.width).toBeCloseTo(primary.width, 0)
  } else {
    expect(pathways.y).toBeCloseTo(primary.y, 0)
    expect(pathways.x).toBeGreaterThan(primary.x + primary.width)
    expect(adaa.width).toBeGreaterThan(primary.width * 1.9)
    expect(longest.width).toBeCloseTo(adaa.width, 0)
  }

  // Item 1 at both widths: the Adaa table stays under its charts, which on a laptop run two to a row.
  const bullets = await page.locator('[data-chart="bullets"]').boundingBox()
  const kpiTable = await page
    .getByRole('heading', { name: 'Adaa KPIs, tracked cases only', exact: true })
    .locator('xpath=../table[1]')
    .boundingBox()
  expect(kpiTable!.y).toBeGreaterThanOrEqual(bullets!.y + bullets!.height - 1)
  const kpi1 = await page.locator('[data-bullet="kpi1"]').boundingBox()
  const kpi2 = await page.locator('[data-bullet="kpi2"]').boundingBox()
  if (mobile) expect(kpi2!.y).toBeGreaterThan(kpi1!.y)
  else expect(kpi2!.y).toBeCloseTo(kpi1!.y, 0)

  // The Range tile is two tiles wide, so its value has room and no row has a hole in it.
  const range = await page.locator('[data-tile-card="Range"]').boundingBox()
  const cases = await page.locator('[data-tile-card="Cases"]').boundingBox()
  expect(range!.width).toBeGreaterThan(cases!.width * 1.9)
  expect(await page.locator('[data-tile="Range"]').evaluate((e) => e.getClientRects().length)).toBe(1)

  await page.emulateMedia({ media: 'print' })
  await expect(jump).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  // The report: one column, and its own order, as before this phase.
  const today = riyadhDateKey(new Date())
  const monthAgo = riyadhDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  await page.goto(`/report?from=${monthAgo}&to=${today}&status=all`)
  await expect(page.locator('[data-report-header]')).toBeVisible()
  expect(await headingsOf(page)).toEqual(REPORT_ORDER)
  const columns = await page
    .locator('.dash h3')
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.parentElement!.getBoundingClientRect()
        return `${Math.round(r.x)}:${Math.round(r.width)}`
      }),
    )
  expect(new Set(columns).size, 'every report section is the one column').toBe(1)
  await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toHaveCount(0)
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
