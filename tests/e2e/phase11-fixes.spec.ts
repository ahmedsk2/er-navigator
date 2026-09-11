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
 * demo found it on said 176 === 176 on every clipped row while its edit box needed 175 px and had
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

/**
 * Finding 4. A `<select>` inside the wrapping `<label>` of `Field` could not be found by its label:
 * the label element's text is its caption and every option after it ("Shift Select Morning Evening
 * Night"), so `getByLabel('Shift', { exact: true })` found nothing. Shift, Primary reason and
 * Final disposition had nothing else; Format, Status, Stage and Role carried an aria-label standing
 * in for the label. Each is now named by a `<label for>` beside it, which holds the caption alone.
 */
async function expectNamedByItsLabel(page: Page, label: string): Promise<void> {
  const select = page.getByRole('combobox', { name: label, exact: true })
  await expect(select).toBeVisible()
  await expect(page.getByLabel(label, { exact: true })).toHaveCount(1)
  const how = await select.evaluate((element) => {
    const own = element as HTMLSelectElement
    const labels = [...(own.labels ?? [])]
    return {
      labels: labels.length,
      byFor: labels[0]?.htmlFor === own.id && own.id !== '',
      wrapped: labels.some((l) => l.contains(own)),
      ariaLabel: own.getAttribute('aria-label'),
    }
  })
  expect(how, label).toEqual({ labels: 1, byFor: true, wrapped: false, ariaLabel: null })
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
  const strip = page.getByRole('navigation', { name: 'Jump to', exact: true })
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

  // The case page's three selects, each named by its label alone (three reasons, so the primary
  // one is asked for).
  for (const label of ['Shift', 'Primary reason (the biggest contributor)', 'Final disposition']) {
    await expectNamedByItsLabel(page, label)
  }
  await page.getByLabel('Shift', { exact: true }).selectOption('EVENING')
  await expect(page.getByRole('combobox', { name: 'Shift', exact: true })).toHaveValue('EVENING')
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

/**
 * Finding 5: a new account is told to change its password "at /account", and nothing on the way
 * there said Account — the menu's row showed a name. It says what it is now, in the menu at both
 * widths and in the rail on a laptop.
 *
 * The administrator's screens: the export's Format and Status, the Lists "Stage", the new user's
 * Role and the audit log's three filters are named by their labels like the case page's selects
 * (finding 4); and on a phone nothing floats over them and the Users list fits (finding 6).
 */
test('the way to the account says so, the admin screens fit a phone, and every select is named by its label', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await fromClientIp(page, mobile ? '198.51.100.235' : '198.51.100.236')
  await signIn(page, E2E_USERS.admin)

  await page.getByRole('button', { name: 'Menu' }).click()
  const row = page.getByRole('menuitem', { name: /Account and password$/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText(`${E2E_USERS.admin.displayName} · Admin`)
  await expect(row).toContainText('Account and password')
  await row.click()
  await expect(page).toHaveURL('/account')
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()

  const rail = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Account and password', exact: true })
  if (mobile) {
    // The phone's tab bar has no room for it; the menu is the way there.
    await expect(rail).toBeHidden()
  } else {
    // The rail's foot names who is signed in and is the way to their account.
    await expect(rail).toBeVisible()
    await expect(rail).toHaveAttribute('aria-current', 'page')
    await page.goto('/')
    await expect(rail).not.toHaveAttribute('aria-current', 'page')
    await rail.click()
    await expect(page).toHaveURL('/account')
  }

  await page.goto('/export')
  await expect(page.getByRole('heading', { name: 'Export and print' })).toBeVisible()
  await expectNamedByItsLabel(page, 'Format')
  await expectNamedByItsLabel(page, 'Status')

  await page.goto('/admin/lists')
  await expect(page.getByRole('heading', { name: 'Reasons', exact: true })).toBeVisible()
  await expectNamedByItsLabel(page, 'Stage')

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible()
  await expectNamedByItsLabel(page, 'Role')

  await page.goto('/admin/audit')
  await expect(page.locator('[data-audit-total]')).toBeVisible()
  for (const label of ['Action', 'Entity', 'Actor']) await expectNamedByItsLabel(page, label)

  // Finding 6. The floating "+ New case" sat over the account form and the admin screens on a
  // phone; it is not drawn there now. The laptop's rail keeps its own, which floats over nothing.
  const newCase = page.getByRole('link', { name: '+ New case' })
  for (const path of ['/account', '/admin', '/admin/users', '/admin/lists', '/admin/other', '/admin/alerts', '/admin/audit']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
    await expect(newCase, path).toHaveCount(mobile ? 0 : 1)
  }
  await page.goto('/')
  await expect(newCase).toBeVisible()

  // And the Users table ran off a phone's right edge, the role, active and reset controls out of
  // reach. Below md each account is a card with every one of them on screen, under the same names.
  await page.goto('/admin/users')
  const username = E2E_USERS.navigator.username
  const account = page.locator(`[data-user="${username}"]`)
  await expect(account).toContainText(E2E_USERS.navigator.displayName)
  await expect(account.locator('[data-active="yes"]')).toBeVisible()
  const width = page.viewportSize()!.width
  for (const control of [
    account.getByRole('textbox', { name: `Email for ${username}`, exact: true }),
    account.getByRole('button', { name: `Save the email for ${username}`, exact: true }),
    account.getByRole('combobox', { name: `Role for ${username}`, exact: true }),
    account.getByRole('button', { name: 'Deactivate', exact: true }),
    account.getByRole('button', { name: 'Reset password', exact: true }),
  ]) {
    await expect(control).toBeVisible()
    const box = (await control.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  }
  const emailHeader = page.getByRole('columnheader', { name: 'Email', exact: true })
  if (mobile) await expect(emailHeader).toBeHidden()
  else await expect(emailHeader).toBeVisible()
})

/**
 * Finding 7: the sign-in hero's ECG trace ran through the headline — "seen in time." sat on the
 * line. It is drawn below the headline block now, at both widths, and behind no text at all: not
 * the wordmark, the headline, the laptop's purpose line and band labels, or the hospital line.
 */
test('the sign-in trace sits below the headline and behind no text', async ({ page }) => {
  await page.goto('/login')
  const hero = page.locator('[data-login-hero]')
  // The trace is the hero's one polyline; the laptop's band bars are rects.
  const trace = hero.locator('svg:has(polyline)')
  await expect(trace).toBeVisible()

  const headline = hero.getByText('Every long stay, seen in time.', { exact: true })
  const traceBox = (await trace.boundingBox())!
  const headlineBox = (await headline.boundingBox())!
  expect(traceBox.y).toBeGreaterThanOrEqual(headlineBox.y + headlineBox.height)

  const overlapped = await hero.evaluate((section) => {
    const line = section.querySelector('svg:has(polyline)')!.getBoundingClientRect()
    return [...section.querySelectorAll('h1, p, text')]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        const shown = box.width > 0 && box.height > 0
        return shown && box.left < line.right && line.left < box.right && box.top < line.bottom && line.top < box.bottom
      })
      .map((el) => el.textContent?.trim())
  })
  expect(overlapped).toEqual([])
})
