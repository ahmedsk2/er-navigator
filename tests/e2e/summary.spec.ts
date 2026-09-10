import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import { BOARD_MRN_PREFIX, LONGEST } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 10 review, Slice 10C: how the case summary panel is left.
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
 */
test.afterAll(async () => {
  await prisma.$disconnect()
})

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
