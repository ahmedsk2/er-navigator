import { expect, test, type Page } from '@playwright/test'
import { CASE_URL, fromClientIp, openCase, signIn, uniqueMrn } from './fixtures/case-flow'
import { E2E_USERS } from './fixtures/seed-users'

/**
 * Phase 11, Slice 11A: the fixes a nurse would feel (docs/specs/phase11-demo-ux-dashboard.md).
 * Each finding of the hands-on demo is pinned here by the thing the nurse saw, at both plan
 * viewports unless the finding is a phone one.
 */

/** "YYYY-MM-DDTHH:mm" plus whole minutes, as wall-clock text: no zone is ever involved. */
function later(base: string, minutes: number): string {
  const at = new Date(`${base}:00Z`)
  at.setUTCMinutes(at.getUTCMinutes() + minutes)
  return at.toISOString().slice(0, 16)
}

type CdpNode = { nodeId: number; nodeName: string; attributes?: string[]; children?: CdpNode[]; shadowRoots?: CdpNode[] }

/**
 * Every visible datetime-local whose value does not fit its box, as "label: needs N px, has M px".
 *
 * Not only the input's own `scrollWidth`, which is what the spec proposed: Chromium draws the value
 * in a user-agent shadow tree (`::-webkit-datetime-edit`) that scrolls inside the input, so the
 * input itself reports `scrollWidth === clientWidth` even while the day is cut off. The build the
 * demo ran (903044c) said 176 === 176 on every clipped row while its edit box needed 175 px and had
 * 132. The edit box is the one that knows, and a page script cannot reach a user-agent shadow
 * root; the DevTools protocol can, and both projects run Chromium.
 */
async function clippedTimes(page: Page): Promise<{ checked: number; clipped: string[] }> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const pairs: Array<{ input: number; edit: number }> = []
    const attribute = (node: CdpNode, name: string): string | undefined => {
      const list = node.attributes ?? []
      for (let i = 0; i < list.length; i += 2) if (list[i] === name) return list[i + 1]
      return undefined
    }
    const walk = (node: CdpNode, input: number | null): void => {
      const inside =
        node.nodeName === 'INPUT' && attribute(node, 'type') === 'datetime-local' ? node.nodeId : input
      if (inside !== null && attribute(node, 'pseudo') === '-webkit-datetime-edit') {
        pairs.push({ input: inside, edit: node.nodeId })
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child, inside)
    }
    walk(root, null)

    const read = async <T,>(nodeId: number, fn: string): Promise<T> => {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId })
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: fn,
        returnByValue: true,
      })
      return result.value as T
    }

    let checked = 0
    const clipped: string[] = []
    for (const { input, edit } of pairs) {
      const [visible, label, scroll, client] = await read<[boolean, string, number, number]>(
        input,
        'function () { return [this.offsetParent !== null, this.labels && this.labels[0] ? this.labels[0].textContent.trim() : this.id, this.scrollWidth, this.clientWidth] }',
      )
      if (!visible) continue
      checked += 1
      const [need, has] = await read<[number, number]>(edit, 'function () { return [this.scrollWidth, this.clientWidth] }')
      if (need > has || scroll > client) clipped.push(`${label}: needs ${Math.max(need, scroll)} px, has ${need > has ? has : client}`)
    }
    return { checked, clipped }
  } finally {
    await cdp.detach()
  }
}

/** The section a strip chip jumps to, found by what a nurse reads at its top. */
function sectionOf(page: Page, chip: string) {
  const top: Record<string, ReturnType<Page['getByRole']>> = {
    Delay: page.getByRole('heading', { name: 'Where is the delay?', exact: true }),
    Teams: page.getByRole('heading', { name: 'Department / consulted team involved', exact: true }),
    Tests: page.getByRole('heading', { name: 'Investigation times', exact: true }),
    Times: page.getByRole('button', { name: /journey times \(optional\)$/ }),
    Updates: page.getByRole('heading', { name: 'Updates', exact: true }),
    Resolve: page.getByRole('heading', { name: 'Resolve case', exact: true }),
  }
  return page.locator('section').filter({ has: top[chip]! })
}

/**
 * Findings 1 and 2. Every time on the case page is a `TimeRow`, and at 390 px its 178 px box cut
 * the day off the value ("0/2026 10:44 PM"). The case below carries every kind the page has —
 * journey, consult, investigation, admission, transfer, pain and case management — each filled,
 * saved and read back from a fresh load, which is the page a nurse opens. The same case is seven
 * phone screens long, so the strip under the header jumps to its sections, and a jump stops below
 * the strip rather than under it.
 */
test('on a worked case every recorded time shows its whole value, and the strip jumps below itself', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.231' : '198.51.100.232')
  const taps = await signIn(page, E2E_USERS.navigator)
  const mrn = uniqueMrn()
  const url = await openCase(page, mrn, 'Admission process', 'No bed available on accepting ward', taps)

  // A chip per section, in page order; Teams because an admission shows the teams, and no Tests
  // until an investigation stage is chosen.
  const strip = page.getByRole('navigation', { name: 'Case sections' })
  await expect(strip.getByRole('link')).toHaveText(['Delay', 'Teams', 'Times', 'Updates', 'Resolve'])

  // The sections that only appear for the reasons behind them: a transfer reason (Referral out),
  // an imaging delay (Investigation times), a consulted team, a painkiller, a case manager.
  await page.getByRole('group', { name: 'Admission process reasons' }).getByRole('button', { name: 'Waiting for RCC / transfer acceptance' }).click()
  await page.getByRole('group', { name: 'Stages' }).getByRole('button', { name: 'Investigations' }).click()
  await page.getByRole('group', { name: 'Investigations reasons' }).getByRole('button', { name: 'Imaging: report delay' }).click()
  await page.getByRole('group', { name: 'Investigation types' }).getByRole('button', { name: 'CT', exact: true }).click()
  await page.getByRole('group', { name: 'Departments' }).getByRole('button', { name: 'CCU', exact: true }).click()
  await page.getByRole('group', { name: 'Painkiller prescribed' }).getByRole('button', { name: 'Yes', exact: true }).click()
  await page.getByRole('group', { name: 'Referred to' }).getByRole('button', { name: 'Case manager', exact: true }).click()

  const registered = await page.getByLabel('Registration time (clock starts here)', { exact: true }).inputValue()
  const times: ReadonlyArray<readonly [string, number]> = [
    ['Triage', 5],
    ['Resus / exam room', 20],
    ['First physician contact', 35],
    ['Ordered', 40],
    ['Painkiller given at', 45],
    ['Consulted at', 60],
    ['Scan done', 70],
    ['Seen patient at', 80],
    ['Preliminary report', 100],
    ['Replied / plan given at', 110],
    ['Reported', 150],
    ['Disposition decided', 160],
    ['Admission order written', 170],
    ['Bed requested (fax sent)', 180],
    ['Transfer requested', 185],
    ['Called at', 200],
    ['Accepted by facility', 230],
    ['Replied at', 240],
    ['Bed assigned', 250],
    ['Medical admin on-call informed at', 260],
    ['RCC / transport arrived', 300],
    ['Nursing handover done', 320],
  ]
  for (const [label, minutes] of times) {
    await page.getByLabel(label, { exact: true }).fill(later(registered, minutes))
  }
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()

  await page.goto(url)
  await expect(page.getByRole('heading', { name: `Case ${mrn}` })).toBeVisible()
  await expect(page.getByLabel('Nursing handover done', { exact: true })).toHaveValue(later(registered, 320))
  await page.evaluate(() => document.fonts.ready)

  const { checked, clipped } = await clippedTimes(page)
  // Every filled row above, the registration, "Left ED" and "Left ED at": nothing was skipped.
  expect(checked).toBeGreaterThanOrEqual(times.length + 3)
  expect(clipped).toEqual([])

  // The strip, now with Tests. The header above it has not moved.
  const chips = ['Delay', 'Teams', 'Tests', 'Times', 'Updates', 'Resolve']
  await expect(strip.getByRole('link')).toHaveText(chips)
  const back = await page.getByRole('link', { name: '‹ Back' }).boundingBox()
  const stripAtRest = await strip.boundingBox()
  expect(back!.y).toBeLessThan(stripAtRest!.y)

  const viewport = page.viewportSize()!
  for (const chip of chips) {
    await strip.getByRole('link', { name: chip, exact: true }).click()
    const section = sectionOf(page, chip)
    // The keyboard lands where the eye does, and a jump is not a history entry: Back still means
    // the board, not the section before.
    await expect(section).toBeFocused()
    await expect(page).toHaveURL(url)
    const box = (await section.boundingBox())!
    const bar = (await strip.boundingBox())!
    if (mobile) {
      // On a phone the strip is stuck to the top of the screen, and the section starts below it.
      expect(Math.abs(bar.y)).toBeLessThan(1)
      expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height)
    } else {
      // On a laptop the strip stays where it is and scrolls away with the header; the section is
      // brought to the top of the screen.
      expect(box.y).toBeGreaterThanOrEqual(0)
    }
    expect(box.y).toBeLessThan(viewport.height / 2)
  }
  if (!mobile) {
    // Not sticky: after the jump to Resolve it has gone off the top with the header.
    expect((await strip.boundingBox())!.y).toBeLessThan(0)
  }
})

/**
 * Finding 3. "Open case" was at the foot of a form that grows with every chip — about 1,500 px
 * below the reason a nurse had just tapped, on a phone — under sections that mean nothing before
 * the case exists. The bar now sticks to the foot of the screen, so the case opens the moment the
 * MRN, the stage and the reason are in, with no scroll; the sections stay where they were.
 */
test('a new case opens from the bar at the foot of the screen', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.233' : '198.51.100.234')
  await signIn(page, E2E_USERS.navigator)
  await page.getByRole('link', { name: '+ New case' }).click()
  await expect(page).toHaveURL('/cases/new')

  const open = page.getByRole('button', { name: 'Open case', exact: true })
  const viewport = page.viewportSize()!
  const atTheFoot = async (): Promise<void> => {
    await expect(open).toBeInViewport({ ratio: 1 })
    const box = (await open.boundingBox())!
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 80)
    // The page goes on below the screen, so this is the bar and not the end of the form.
    const [seen, total] = await page.evaluate(() => [window.scrollY + window.innerHeight, document.documentElement.scrollHeight])
    expect(seen).toBeLessThan(total)
  }

  // On screen before anything is typed, and dead until the case can be opened.
  await atTheFoot()
  await expect(open).toBeDisabled()

  const mrn = uniqueMrn()
  await page.getByLabel('MRN (digits only)', { exact: true }).fill(mrn)
  await page.getByRole('group', { name: 'Stages' }).getByRole('button', { name: 'Admission process' }).click()
  await page
    .getByRole('group', { name: 'Admission process reasons' })
    .getByRole('button', { name: 'No bed available on accepting ward' })
    .click()

  // The form has grown by the reasons, the teams, pain, admission times and case management, and
  // the bar is still where the thumb is.
  await atTheFoot()
  await expect(open).toBeEnabled()
  await open.click()
  await expect(page).toHaveURL(CASE_URL)
  await expect(page.getByRole('heading', { name: `Case ${mrn}` })).toBeVisible()
})
