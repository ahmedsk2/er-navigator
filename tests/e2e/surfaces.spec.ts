import { expect, test, type Locator, type Page } from '@playwright/test'
import { BOARD_MRN_PREFIX, LONGEST } from './fixtures/board-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * The surfaces of Phase 9, Slice 9C: the board row as a card with the elapsed time in a
 * band-coloured pill, the five-column desktop row under its label strip, and the dashboard's
 * sections as cards with an icon in the heading.
 *
 * Geometry and computed style, not class names: a class in a template proves nothing about what
 * a nurse sees, and every other spec in this suite already proves the text and the links. What
 * this file guards is that the dressing went on without moving anything — which is why it also
 * re-asserts, from the inside, the two structures the dashboard's own spec selects on
 * (`section > h3` first, the table as the h3's sibling) and the counters sentence the board's
 * spec matches as one element.
 */

const style = (el: Locator, property: string): Promise<string> =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), property)

/** `rgb(a, b, c)` -> `#aabbcc`, so a computed colour can be compared with a token. */
async function hexOf(el: Locator, property: string): Promise<string> {
  const value = await style(el, property)
  const parts = value.match(/\d+(\.\d+)?/g)
  if (!parts) return value
  return `#${parts
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`
}

async function boardWithFixtures(page: Page, ip: string): Promise<void> {
  await fromClientIp(page, ip)
  await signIn(page, E2E_USERS.navigator)
  await page.getByLabel('Search MRN').fill(BOARD_MRN_PREFIX)
  await expect(page.locator(`a[data-mrn="${LONGEST.mrn}"]`)).toBeVisible()
}

test('a board row is a card, and its elapsed time is a pill in the band colour', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await boardWithFixtures(page, mobile ? '198.51.100.141' : '198.51.100.142')

  const row = page.locator(`a[data-mrn="${LONGEST.mrn}"]`)
  await expect(row).toHaveAttribute('data-band', 'h24')

  // A card: rounded, inset from the edge of the screen, and on its own white ground.
  const radius = Number.parseFloat(await style(row, 'border-top-left-radius'))
  expect(radius).toBeGreaterThan(8)
  const box = (await row.boundingBox())!
  expect(box.x).toBeGreaterThan(mobile ? 8 : 200)
  expect(await hexOf(row, 'background-color')).toBe('#ffffff')

  // The band stripe is gone; the clock carries the band as a filled pill instead.
  // `--color-band-h24` is #16243b and the text on it is white (13.9:1).
  const pill = row.locator('.num').last()
  await expect(pill).toContainText(/\d+h \d\dm/)
  expect(await hexOf(pill, 'background-color')).toBe('#16243b')
  expect(await hexOf(pill, 'color')).toBe('#ffffff')
  expect(Number.parseFloat(await style(pill, 'border-top-left-radius'))).toBeGreaterThan(4)

  // The sentence a screen reader hears is still the whole duration, not the tabular text.
  await expect(pill.locator('.sr-only')).toHaveText(/^In the Emergency Department /)
})

test('the desktop row is five columns under a label strip, and the phone has neither', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await boardWithFixtures(page, mobile ? '198.51.100.143' : '198.51.100.144')

  const row = page.locator(`a[data-mrn="${LONGEST.mrn}"]`)
  const columns = (await style(row, 'grid-template-columns')).split(/\s+/).filter(Boolean)
  const labels = page.locator('[data-board-columns]')

  if (mobile) {
    await expect(labels).toBeHidden()
    // Two columns on the phone: the three stacked lines, and the pill beside all of them.
    expect(columns.length).toBe(2)
  } else {
    // MRN · Registered · Waiting on · Last update · Elapsed.
    expect(columns.length).toBe(5)
    await expect(labels).toBeVisible()
    await expect(labels).toHaveAttribute('aria-hidden', 'true')
    await expect(labels).toContainText('MRN')
    await expect(labels).toContainText('Registered')
    await expect(labels).toContainText('Waiting on')
    await expect(labels).toContainText('Last update')
    await expect(labels).toContainText('Elapsed')
    // The strip sits above the first row and shares its grid, so the columns line up.
    const stripBox = (await labels.boundingBox())!
    const rowBox = (await row.boundingBox())!
    expect(stripBox.y).toBeLessThan(rowBox.y)
    expect(Math.abs(stripBox.width - rowBox.width)).toBeLessThan(40)
  }
})

test('the counters are one sentence with three weighted figures', async ({ page }, testInfo) => {
  await boardWithFixtures(page, testInfo.project.name === 'mobile' ? '198.51.100.145' : '198.51.100.146')

  // The contract: one element carrying the whole sentence (tests/e2e/board.spec.ts matches it).
  const counters = page.getByText(/\d+ open · \d+ past 6h · \d+ past 12h/)
  await expect(counters).toBeVisible()

  // Phase 9: the three figures are picked out inside it, in the colour of what they count.
  const figures = counters.locator('span')
  await expect(figures).toHaveCount(3)
  for (let i = 0; i < 3; i += 1) {
    expect(Number(await style(figures.nth(i), 'font-weight'))).toBeGreaterThanOrEqual(600)
  }
  expect(await hexOf(figures.nth(1), 'color')).toBe('#b93a2e')
  expect(await hexOf(figures.nth(2), 'color')).toBe('#6b2058')
})

test('every dashboard section is a card whose h3 keeps its place and its name', async ({ page }, testInfo) => {
  await fromClientIp(page, testInfo.project.name === 'mobile' ? '198.51.100.147' : '198.51.100.148')
  await signIn(page, E2E_USERS.navigator)
  await page.goto('/dashboard')

  const section = page.getByRole('heading', { name: 'Cases past each threshold', exact: true }).locator('xpath=..')
  await expect(section).toHaveJSProperty('tagName', 'SECTION')
  expect(Number.parseFloat(await style(section, 'border-top-left-radius'))).toBeGreaterThan(8)
  expect(await hexOf(section, 'background-color')).toBe('#ffffff')

  // The two structures tests/e2e/dashboard.spec.ts selects on: the h3 is the section's first
  // element child, and the table is its sibling.
  const first = await section.evaluate((el) => el.firstElementChild?.tagName ?? '')
  expect(first).toBe('H3')
  await expect(section.locator('> table')).toHaveCount(1)

  // The icon is inside the heading and decorative: the accessible name is the title alone.
  const heading = section.locator('> h3')
  await expect(heading.locator('svg[aria-hidden="true"]')).toHaveCount(1)
  await expect(heading).toHaveAccessibleName('Cases past each threshold')

  // And the tiles carry their tinted square without moving the number they hold.
  const tile = page.locator('[data-tile="Cases"]')
  await expect(tile).toBeVisible()
  await expect(page.locator('[data-tile-icon]').first()).toBeVisible()
})
