import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { BOARD_MRN_PREFIX, LONGEST, VOIDED } from './fixtures/board-cases'
import { fromClientIp, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 10 review, Slice 10C: how the case summary panel is left, and who may read its route.
 *
 * The panel used to close on a document-level touchstart outside it. On a phone that is a ghost
 * click: React takes the scrim away before the finger lifts, and the click the browser makes after
 * touchend is hit-tested afresh, so it landed on whatever the scrim had been covering — on the
 * board the row's link (the sheet closed and the case opened), on the case page "‹ Back". The
 * panel now closes from the scrim's own click, while the scrim is still there to take it.
 *
 * Both projects make the press the way their user would: a finger on the phone, a mouse on the
 * laptop. The point pressed is proven first to be the scrim on top with the control a ghost click
 * would hit underneath, so a green run cannot mean the press simply missed.
 *
 * The board's panel belongs to the board and not to the row it summarises, so a poll that drops
 * the row leaves it open; and a summary that cannot be read says so on a line of its own under the
 * row, without taking the card's width (both from the same review).
 *
 * The route the board's row button reads is held to its two guards: a live session (proxy.ts turns
 * away a request with no cookie at all, the route's own requireUser one whose cookie matches no
 * session) and a 404 for a voided case, which the board never lists.
 */
test.afterAll(async () => {
  await prisma.$disconnect()
})

/** The session cookie's name, spelt as board.spec.ts spells it (route-gate.test.ts pins it). */
const SESSION_COOKIE = '__Host-ern_session'

type Point = { x: number; y: number }

/**
 * A point over `selector` the panel does not cover — above the bottom sheet on a phone, beside the
 * centred dialog on a laptop — where `elementFromPoint` is the scrim and the stack beneath it
 * holds `selector`.
 */
async function scrimPointOver(page: Page, selector: string): Promise<Point> {
  const target = await page.locator(selector).boundingBox()
  const panel = await page.locator('[data-summary-dialog]').boundingBox()
  const viewport = page.viewportSize()
  if (!target || !panel || !viewport) throw new Error(`no geometry for ${selector}, the panel or the viewport`)
  const inPanel = (x: number, y: number): boolean =>
    x >= panel.x && x <= panel.x + panel.width && y >= panel.y && y <= panel.y + panel.height
  for (const fy of [0.5, 0.25, 0.75]) {
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = Math.round(target.x + target.width * fx)
      const y = Math.round(target.y + target.height * fy)
      if (x < 1 || y < 1 || x >= viewport.width - 1 || y >= viewport.height - 1 || inPanel(x, y)) continue
      const hit = await page.evaluate(
        ({ x, y, selector }) => ({
          scrim: document.elementFromPoint(x, y)?.hasAttribute('data-summary-scrim') ?? false,
          over: document.elementsFromPoint(x, y).some((element) => element.closest(selector) !== null),
        }),
        { x, y, selector },
      )
      if (hit.scrim && hit.over) return { x, y }
    }
  }
  throw new Error(`no point over ${selector} is left uncovered by the panel`)
}

/** A finger on the phone, a mouse on the laptop. */
async function pressAt(page: Page, point: Point, mobile: boolean): Promise<void> {
  if (mobile) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
}

/**
 * Every click the page receives from now on, by what it landed on: "scrim", or the href of the
 * link it activated, or the tag name. One press is one click, so after a press this says exactly
 * what it did — the whole bug was a press on the scrim becoming a click on the link under it.
 */
async function recordClicks(page: Page): Promise<() => Promise<string[] | null>> {
  await page.evaluate(() => {
    const landed: string[] = []
    Object.assign(window, { __summaryClicks: landed })
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element
        landed.push(
          target.hasAttribute('data-summary-scrim')
            ? 'scrim'
            : (target.closest('a')?.getAttribute('href') ?? target.tagName.toLowerCase()),
        )
      },
      { capture: true },
    )
  })
  return () => page.evaluate(() => (window as unknown as { __summaryClicks?: string[] }).__summaryClicks ?? null)
}

/**
 * What a stray tap could have changed in the editor. It keeps no "unsaved changes" flag to look
 * at, so this is every field's value and every chip's pressed state, in document order.
 */
function editorState(page: Page): Promise<string[]> {
  return page.locator('main').evaluate((main) => [
    ...Array.from(main.querySelectorAll('input, select, textarea'), (element) => {
      const field = element as HTMLInputElement
      return `${field.type}=${field.type === 'checkbox' ? String(field.checked) : field.value}`
    }),
    ...Array.from(
      main.querySelectorAll('[aria-pressed]'),
      (element) => `${element.textContent?.trim()}:${element.getAttribute('aria-pressed')}`,
    ),
  ])
}

test('a press on the scrim closes the board summary and never opens the row under it', async ({ page }, testInfo) => {
  await fromClientIp(page, '198.51.100.171')
  await signIn(page, E2E_USERS.navigator)
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  const row = `a[data-mrn="${LONGEST.mrn}"]`
  await expect(page.locator(row)).toBeVisible()
  const rows = await page.locator('a[data-mrn]').count()
  const board = page.url()

  // The row to the top of the screen: the phone's bottom sheet leaves the scrim uncovered there.
  await page.locator(row).evaluate((element) => element.scrollIntoView({ block: 'start' }))
  const opener = page.locator(`[data-summary-for="${LONGEST.mrn}"]`)
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()

  const point = await scrimPointOver(page, row)
  const clicks = await recordClicks(page)
  await pressAt(page, point, testInfo.project.name === 'mobile')

  await expect(dialog).toHaveCount(0)
  // The press's one click was the scrim's, not the row link's...
  await expect.poll(clicks).toEqual(['scrim'])
  // ...so this is still the board, every row still on it, and the keyboard back on the button.
  expect(page.url(), 'no navigation to the case under the scrim').toBe(board)
  await expect(page.locator('a[data-mrn]')).toHaveCount(rows)
  await expect(opener).toBeFocused()
})

test('a press on the scrim closes the case summary and leaves the editor as it was', async ({ page }, testInfo) => {
  const target = await prisma.case.findFirstOrThrow({
    where: { mrn: LONGEST.mrn, status: 'OPEN' },
    select: { id: true },
  })
  await fromClientIp(page, '198.51.100.172')
  await signIn(page, E2E_USERS.navigator)
  await page.goto(`/cases/${target.id}`)
  await expect(page.getByRole('heading', { name: `Case ${LONGEST.mrn}` })).toBeVisible()
  // The time inputs stay empty until the editor hydrates; the snapshot waits for it.
  await expect(page.getByLabel('Registration time (clock starts here)')).not.toHaveValue('')
  const before = await editorState(page)

  const opener = page.getByRole('button', { name: 'Summary', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()

  // "‹ Back": on a phone the one control in the strip the sheet leaves uncovered.
  const back = 'main a[href="/"]'
  await expect(page.locator(back)).toHaveCount(1)
  const point = await scrimPointOver(page, back)
  const clicks = await recordClicks(page)
  await pressAt(page, point, testInfo.project.name === 'mobile')

  await expect(dialog).toHaveCount(0)
  await expect.poll(clicks).toEqual(['scrim'])
  expect(new URL(page.url()).pathname, 'still the same case, not the board behind "‹ Back"').toBe(
    `/cases/${target.id}`,
  )
  await expect(page.getByRole('heading', { name: `Case ${LONGEST.mrn}` })).toBeVisible()
  expect(await editorState(page), 'nothing in the editor changed').toEqual(before)
  await expect(opener).toBeFocused()
})

test('a press that starts or ends inside the panel leaves it open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'a mouse drag is a laptop gesture; the phone taps, above')
  const target = await prisma.case.findFirstOrThrow({
    where: { mrn: LONGEST.mrn, status: 'OPEN' },
    select: { id: true },
  })
  await fromClientIp(page, '198.51.100.174')
  await signIn(page, E2E_USERS.navigator)
  await page.goto(`/cases/${target.id}`)
  await page.getByRole('button', { name: 'Summary', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()

  const outside = await scrimPointOver(page, 'main a[href="/"]')
  const cell = await dialog.locator('td').first().boundingBox()
  if (!cell) throw new Error('the summary has no table cell to press on')
  const inside = { x: Math.round(cell.x + cell.width / 2), y: Math.round(cell.y + cell.height / 2) }
  const drag = async (from: Point, to: Point): Promise<void> => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 5 })
    await page.mouse.up()
  }

  // A text selection dragged out of the panel and let go over the scrim.
  await drag(inside, outside)
  await expect(dialog).toBeVisible()
  // A press on the scrim let go inside the panel. Its click lands on the scrim all the same (the
  // nearest element holding both ends), so the scrim has to note where the press ended as well.
  // The selection the first drag made goes first: pressed while it stands, the drag below would
  // become the browser's own drag of the selected text, which ends without any click at all.
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await drag(outside, inside)
  await expect(dialog).toBeVisible()
  // And a plain click on the same point does close it, so the two above did reach the scrim.
  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toHaveCount(0)
})

/**
 * The panel used to be rendered inside the row it summarises, so when the 30 s poll dropped that
 * row — a colleague resolved the case, or edited it out of the filter — the panel went with it,
 * mid-read, and the keyboard fell to <body>. Now the row can go and the panel stays until it is
 * closed; closing it puts the keyboard on the page title, since the button that opened it is gone
 * (not on the search box, which would raise the phone's keyboard over the list).
 *
 * A case of the test's own, so resolving it disturbs no fixture another test reads. It is written
 * and resolved straight in the database, as the fixtures are: the board cannot tell that from a
 * colleague's save, and the editor's resolve flow is cases.spec.ts's to test.
 */
test('a row summary outlives its row leaving the board, and closing it lands on the page title', async ({ page }) => {
  test.setTimeout(90_000)
  const mrn = uniqueMrn()
  const [navigator, reason] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: E2E_USERS.navigator.username }, select: { id: true } }),
    prisma.reason.findFirstOrThrow({
      where: { name: LONGEST.reason.name, stage: { code: LONGEST.reason.stage } },
      select: { id: true },
    }),
  ])
  const registrationAt = new Date(Date.now() - 5 * 36e5)
  const created = await prisma.case.create({
    data: {
      mrn,
      registrationAt,
      openedAt: registrationAt,
      openedById: navigator.id,
      primaryReasonId: reason.id,
      reasons: { create: [{ reasonId: reason.id }] },
    },
    select: { id: true },
  })

  await fromClientIp(page, '198.51.100.202')
  await signIn(page, E2E_USERS.navigator)
  await page.getByLabel('Search MRN').fill(mrn)
  const row = page.locator(`a[data-mrn="${mrn}"]`)
  await expect(row).toBeVisible()
  await page.locator(`[data-summary-for="${mrn}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog.getByRole('row', { name: /^MRN/ })).toContainText(mrn)

  // A colleague resolves it. The wait is for the first poll to answer without it, whenever that
  // is: a poll already in flight when the case changed can still list it.
  const dropped = page.waitForResponse(
    async (response) =>
      /\/api\/board\?/.test(response.url()) &&
      response.ok() &&
      !((await response.json()) as { rows: Array<{ mrn: string }> }).rows.some((r) => r.mrn === mrn),
    { timeout: 45_000 },
  )
  const leftAt = new Date()
  await prisma.case.update({
    where: { id: created.id },
    data: {
      status: 'RESOLVED',
      departedAt: leftAt,
      resolvedAt: leftAt,
      disposition: 'DISCHARGED_HOME',
      version: { increment: 1 },
    },
  })
  await dropped

  // The row has gone — the search now matches nothing at all — and the panel is still open.
  await expect(row).toHaveCount(0)
  await expect(page.getByText(`No case matching ${mrn}.`)).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('row', { name: /^MRN/ })).toContainText(mrn)

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ER board' })).toBeFocused()
})

/**
 * When the summary cannot be read the button says so, and that line used to be a third item in
 * the row's one flex line: the card gave it the room (about 306 → 144 px on a phone), and on a
 * laptop its cells slid out from under the column labels. It now wraps onto a line of its own
 * under the card, and the card and the button keep their size.
 */
test('a summary that cannot be read says so under the row, and the card keeps its width', async ({ page }) => {
  await fromClientIp(page, '198.51.100.203')
  await signIn(page, E2E_USERS.navigator)
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  const card = page.locator(`a[data-mrn="${LONGEST.mrn}"]`)
  const opener = page.locator(`[data-summary-for="${LONGEST.mrn}"]`)
  await expect(card).toBeVisible()
  const before = { card: await card.boundingBox(), opener: await opener.boundingBox() }

  await page.route('**/api/cases/*/summary', (route) => route.fulfill({ status: 500 }))
  await opener.click()
  const message = page.locator('li', { has: card }).getByRole('status')
  await expect(message).toHaveText('Could not read the summary.')
  await expect(message).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Case summary' })).toHaveCount(0)

  const after = {
    card: await card.boundingBox(),
    opener: await opener.boundingBox(),
    message: await message.boundingBox(),
  }
  if (!before.card || !before.opener || !after.card || !after.opener || !after.message) {
    throw new Error('no geometry for the card, its summary button or the message')
  }
  expect(after.card.width, 'the card keeps its width').toBe(before.card.width)
  expect(after.opener.width, 'the button keeps its width').toBe(before.opener.width)
  expect(after.message.y, 'the message is on a line of its own, under the card').toBeGreaterThanOrEqual(
    after.card.y + after.card.height,
  )
})

test('GET /api/cases/[id]/summary answers 401 without a live session, and is never cached', async ({ request }) => {
  const live = await prisma.case.findFirstOrThrow({ where: { mrn: LONGEST.mrn, status: 'OPEN' }, select: { id: true } })

  // No cookie at all: proxy.ts answers before the route runs, with a status a fetch can use.
  const signedOut = await request.get(`/api/cases/${live.id}/summary`)
  expect(signedOut.status()).toBe(401)
  expect(signedOut.headers()['cache-control']).toContain('no-store')

  // A cookie the gate lets through and no session row matches: the route's own requireUser.
  const forged = await request.get(`/api/cases/${live.id}/summary`, {
    headers: { cookie: `${SESSION_COOKIE}=not-a-session-token` },
  })
  expect(forged.status()).toBe(401)
  expect(forged.headers()['cache-control']).toContain('no-store')
  expect(await forged.json()).toEqual({ error: 'unauthorized' })
})

test('GET /api/cases/[id]/summary reads a live case without its update text, and 404s a voided or unknown one', async ({
  page,
}) => {
  const live = await prisma.case.findFirstOrThrow({
    where: { mrn: LONGEST.mrn, status: 'OPEN' },
    select: { id: true, updates: { select: { text: true } } },
  })
  const voided = await prisma.case.findFirstOrThrow({ where: { mrn: VOIDED.mrn, status: 'VOIDED' }, select: { id: true } })
  // The fixture gives the longest stay an update; its text is what must never come back.
  expect(live.updates.length).toBeGreaterThan(0)

  await fromClientIp(page, '198.51.100.173')
  await signIn(page, E2E_USERS.navigator)

  const read = await page.request.get(`/api/cases/${live.id}/summary`)
  expect(read.status()).toBe(200)
  expect(read.headers()['cache-control']).toContain('no-store')
  const body = await read.text()
  const summary = JSON.parse(body) as { mrn: string; updates: { count: number } }
  expect(summary.mrn).toBe(LONGEST.mrn)
  // Counted, never quoted.
  expect(summary.updates.count).toBe(live.updates.length)
  for (const update of live.updates) expect(body).not.toContain(update.text)

  // The route's own 404 — its JSON, not the framework's not-found page — for a voided case and
  // for an id that was never a case.
  for (const id of [voided.id, 'no-such-case']) {
    const missing = await page.request.get(`/api/cases/${id}/summary`)
    expect(missing.status(), id).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })
  }
})
