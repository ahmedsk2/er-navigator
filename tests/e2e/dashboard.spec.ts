import { expect, test, type Page } from '@playwright/test'
import type { BoardPayload } from '../../src/lib/board/types'
import { inRange, type CaseForStats, type Range } from '../../src/lib/domain/aggregates'
import { headline } from '../../src/lib/domain/kpi'
import { MIN_N, fmtHours } from '../../src/lib/domain/time'
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
        handoverAt: null,
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
    'By week: cases and median stay',
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

  // The two client charts actually mounted.
  await expect(page.locator('[data-chart-panel="cases"] svg[role="application"]')).toBeVisible()
  await expect(page.locator('[data-chart="hbar"] svg[role="application"]').first()).toBeVisible()

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
