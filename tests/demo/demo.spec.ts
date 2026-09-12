/**
 * ER Navigator — the hands-on demo. One shift, start to finish, on a phone:
 *
 *   1. the admin creates the team (two navigators, a charge nurse, the medical director);
 *   2. each new user signs in with the temporary password; Nadia sets her own;
 *   3. Nadia and Omar open five patients as the delays arise, with real-looking times;
 *   4. the board at its busiest: bands, filter, a row summary, the handover sheet;
 *   5. the navigators work each case (times, consults, updates with action tags) and resolve it;
 *   6. Sara, the charge nurse, reviews the resolved cases and pulls the workbook and the report;
 *   7. Dr Huda, read-only, opens the dashboard on her phone and on her laptop.
 *
 * Every MRN is invented; no patient name appears anywhere. Staff names are fictional.
 * Screenshots land in ./shots as NN-step.png; ./shots/log.json records each step's actions and time.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

test.describe.configure({ mode: 'serial' })

const SHOTS = process.env.DEMO_SHOTS ?? join(__dirname, '..', '..', 'test-results', 'demo-shots')
mkdirSync(SHOTS, { recursive: true })
const NOW = Date.now()
/** The demo database's first admin, as `scripts/demo-reset.sh` seeds it. Demo-only; never a real password. */
const ADMIN = { username: 'admin', password: process.env.DEMO_ADMIN_PASSWORD ?? 'demo-only-admin-password' }

/** "YYYY-MM-DDTHH:mm" in Asia/Riyadh (UTC+3, no DST), `hoursAgo` before the demo started. */
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * 3_600_000 + 3 * 3_600_000).toISOString().slice(0, 16)

type Staff = { username: string; displayName: string; role: 'NAVIGATOR' | 'SUPERVISOR' | 'VIEWER'; email: string; ip: string; password?: string; changed?: boolean }
const TEAM: Staff[] = [
  { username: 'nadia', displayName: 'Nadia Salem', role: 'NAVIGATOR', email: 'nadia.salem@qch.example', ip: '10.20.0.11' },
  { username: 'omar', displayName: 'Omar Faris', role: 'NAVIGATOR', email: 'omar.faris@qch.example', ip: '10.20.0.12' },
  { username: 'sara', displayName: 'Sara Nasser', role: 'SUPERVISOR', email: 'sara.nasser@qch.example', ip: '10.20.0.13' },
  { username: 'huda', displayName: 'Dr Huda Khalid', role: 'VIEWER', email: 'huda.khalid@qch.example', ip: '10.20.0.14' },
]
const staff = (username: string): Staff => TEAM.find((s) => s.username === username)!

/**
 * Phase 12 item 3 (D4): the kit's five MRNs moved onto the demo prefix — six 9s and an ordinal —
 * so nothing this script types could be mistaken for a hospital record number. They were five
 * consecutive plausible 7-digit numbers, which is exactly the shape the real sheets use.
 */

// ---------------------------------------------------------------------------------------------
// The log: every step with the actions it took and how long it took, for the UX review.

type Step = { n: number; name: string; who: string; actions: number; ms: number; url: string; shots: string[]; notes: string[] }
const LOG: Step[] = []
let shotNo = 0
let current: Step | null = null

function begin(name: string, who: string): void {
  current = { n: LOG.length + 1, name, who, actions: 0, ms: Date.now(), url: '', shots: [], notes: [] }
}
function end(page: Page): void {
  if (!current) return
  current.ms = Date.now() - current.ms
  current.url = new URL(page.url()).pathname
  LOG.push(current)
  current = null
  writeFileSync(join(SHOTS, 'log.json'), JSON.stringify(LOG, null, 2))
}
function note(text: string): void {
  current?.notes.push(text)
}
const act = (n = 1): void => {
  if (current) current.actions += n
}

async function shot(page: Page, name: string, opts: { full?: boolean; mask?: Locator[] } = {}): Promise<void> {
  shotNo += 1
  const file = `${String(shotNo).padStart(2, '0')}-${name}.png`
  await page.waitForLoadState('networkidle').catch(() => {})
  // A full-page capture paints a sticky element where the page was last scrolled to; from the top
  // it is painted where it rests.
  if (opts.full ?? true) await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(SHOTS, file), fullPage: opts.full ?? true, mask: opts.mask })
  current?.shots.push(file)
}

// ---------------------------------------------------------------------------------------------
// The moves a nurse makes, each counted.

async function signIn(page: Page, username: string, password: string, lands: '/' | '/account' = '/'): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  act(3)
  await expect(page).toHaveURL(lands)
}

/**
 * Phase 12 item 5 (P12): an account the Admin screen has just created is still on the temporary
 * password that was read out, so its first sign-in lands on /account and reaches nothing else
 * until it sets its own. Nadia does this by hand in test 2 because the presenter shows it; Omar,
 * Sara and Huda do it here so the rest of the kit can run.
 */
async function firstSignIn(page: Page, person: Staff): Promise<void> {
  await signIn(page, person.username, person.password!, '/account')
  const fresh = `demo-only-${person.username}-password`
  await fill(page.getByLabel('Current password', { exact: true }), person.password!)
  await fill(page.getByLabel('New password', { exact: true }), fresh)
  await fill(page.getByLabel('New password again', { exact: true }), fresh)
  await tap(page.getByRole('button', { name: 'Change password', exact: true }))
  // Wait for the confirmation rather than a fixed 800 ms: the action deletes every session and
  // issues a fresh cookie, and a `goto` sent before that cookie lands arrives with the deleted
  // one and is bounced to /login?expired=1.
  await expect(page.getByText('Password changed. Your other devices have been signed out.')).toBeVisible()
  person.password = fresh
  person.changed = true
  await page.goto('/')
  await expect(page).toHaveURL('/')
}

/** Their first sign-in if they still hold a temporary password, an ordinary one after that. */
async function enter(page: Page, person: Staff): Promise<void> {
  if (person.changed) await signIn(page, person.username, person.password!)
  else await firstSignIn(page, person)
}

async function newSession(browser: Browser, who: Staff | typeof ADMIN & { ip: string }, desktop = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(
    desktop
      ? { viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Riyadh', locale: 'en-GB' }
      : {},
  )
  const page = await ctx.newPage()
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': who.ip })
  return { ctx, page }
}

const chip = (page: Page, group: string, name: string | RegExp) =>
  page.getByRole('group', { name: group, exact: true }).getByRole('button', { name, exact: typeof name === 'string' })

async function tap(locator: Locator): Promise<void> {
  await locator.click()
  act()
}
async function fill(locator: Locator, value: string): Promise<void> {
  await locator.fill(value)
  act()
}
async function time(page: Page, label: string, hoursAgo: number): Promise<void> {
  await fill(page.getByLabel(label, { exact: true }), at(hoursAgo))
}
async function save(page: Page): Promise<void> {
  await tap(page.getByRole('button', { name: 'Save changes', exact: true }))
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
}
async function update(page: Page, text: string, tag?: string): Promise<void> {
  if (tag) await tap(chip(page, 'Action taken (optional)', tag))
  await fill(page.getByLabel('What changed?', { exact: true }), text)
  await page.getByLabel('What changed?', { exact: true }).press('Enter')
  act()
  await expect(page.getByRole('listitem').filter({ hasText: text }).first()).toBeVisible()
}
/**
 * Phase 13: the journey times are always on the sheet, and the shift, the working diagnosis, the
 * payer, pain management and case management are behind "More to record", closed until a case
 * carries one of them.
 */
async function openMore(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: 'More to record', exact: true })
  if ((await more.getAttribute('aria-expanded')) !== 'true') await tap(more)
  await expect(more).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Phase 13: a journey step with a time collapses to one line. Reopen every one of them before a
 * screenshot of a worked case, so the sheet shows what was recorded rather than a list of lines.
 */
async function reopenJourney(page: Page): Promise<void> {
  const edits = page.getByRole('button', { name: /^Edit — / })
  for (let i = await edits.count(); i > 0; i -= 1) await edits.first().click()
}
async function choosePrimary(page: Page, reason: string): Promise<void> {
  const select = page.getByRole('combobox', { name: /^Primary reason/ })
  if (!(await select.isVisible().catch(() => false))) return
  const value = await select.evaluate((el, r) => {
    const option = Array.from((el as HTMLSelectElement).options).find((o) => o.textContent?.includes(r))
    return option?.value ?? ''
  }, reason)
  if (value) {
    await select.selectOption(value)
    act()
  }
}

// ---------------------------------------------------------------------------------------------
// The five patients. Hours are "hours before the demo started".

type Patient = {
  mrn: string
  by: string
  story: string
  regH: number
  ctas: number
  dx: string
  area: string
  payer: 'Government' | 'Insured' | 'Self-pay'
  shift: 'Morning' | 'Evening' | 'Night'
  delays: Array<{ stage: string; reason: string; other?: string }>
  primary: string
  dept?: string
  inv?: { type: string; steps: Array<[string, number]> }
  consult?: Array<[string, number]>
  journey: Array<[string, number]>
  admission?: Array<[string, number]>
  transfer?: { tracking: string; facility: string; steps: Array<[string, number]> }
  medAdminH?: number
  updates: Array<{ text: string; tag?: string }>
  resolve: { dispo: string; label: string; ward?: RegExp; instructions?: 'Yes' | 'No'; family?: 'Yes' | 'No'; leftH: number; note: string }
}

const PATIENTS: Patient[] = [
  {
    mrn: '99999941',
    by: 'nadia',
    story: 'CTAS 2 chest pain, NSTEMI; waits for a CCU bed',
    regH: 10,
    ctas: 2,
    dx: 'Chest pain, NSTEMI, for CCU',
    area: 'Acute area',
    payer: 'Government',
    shift: 'Evening',
    delays: [{ stage: 'Admission process', reason: 'No bed available on accepting ward' }],
    primary: 'No bed available on accepting ward',
    dept: 'CCU',
    consult: [
      ['Consulted at', 8.5],
      ['Seen patient at', 8],
      ['Replied / plan given at', 7.2],
    ],
    journey: [
      ['Triage', 9.85],
      ['Resus / exam room', 9.7],
      ['First physician contact', 9.4],
      ['Disposition decided', 7],
    ],
    admission: [
      ['Admission order written', 6.8],
      ['Bed requested (fax sent)', 6.6],
      ['Bed assigned', 1.5],
    ],
    medAdminH: 4,
    updates: [
      { text: 'Bed requested from CCU, none free yet', tag: 'Case / bed management' },
      { text: 'Escalated to the medical admin on-call; CCU to step one patient down', tag: 'Leadership escalation' },
      { text: 'CCU bed 4 assigned, handover in progress' },
    ],
    resolve: { dispo: 'ADMITTED', label: 'Admitted', ward: /^CCU$/, family: 'Yes', leftH: 0.5, note: 'To CCU bed 4' },
  },
  {
    mrn: '99999942',
    by: 'nadia',
    story: 'CTAS 3 right iliac fossa pain; ultrasound report and surgical review',
    regH: 8,
    ctas: 3,
    dx: 'RIF pain, query appendicitis',
    area: 'Rapid assessment zone',
    payer: 'Insured',
    shift: 'Evening',
    delays: [
      { stage: 'Investigations', reason: 'Imaging: report delay' },
      { stage: 'Referral / consulted team', reason: 'Awaiting consulted team response/callback' },
    ],
    primary: 'Imaging: report delay',
    dept: 'General Surgery',
    inv: {
      type: 'Ultrasound',
      steps: [
        ['Ordered', 7],
        ['Scan done', 5.5],
        ['Preliminary report', 4.8],
        ['Reported', 3.5],
      ],
    },
    consult: [
      ['Consulted at', 3.3],
      ['Seen patient at', 2.6],
      ['Replied / plan given at', 2],
    ],
    journey: [
      ['Triage', 7.85],
      ['Resus / exam room', 7.5],
      ['First physician contact', 7.2],
      ['Disposition decided', 1.8],
    ],
    updates: [
      { text: 'Ultrasound done, waiting for the formal report' },
      { text: 'Radiology called for the report; surgery paged' },
    ],
    resolve: { dispo: 'DISCHARGED_HOME', label: 'Discharged home', instructions: 'Yes', family: 'Yes', leftH: 1, note: 'Not appendicitis; GP follow-up in 48 h' },
  },
  {
    mrn: '99999943',
    by: 'nadia',
    story: 'CTAS 4 wrist fracture needing a hand surgeon; transferred out via RCC',
    regH: 14,
    ctas: 4,
    dx: 'Distal radius fracture, displaced',
    area: 'Pooling area',
    payer: 'Self-pay',
    shift: 'Morning',
    delays: [
      { stage: 'Referral / consulted team', reason: 'Referral sent, awaiting acceptance' },
      { stage: 'Admission process', reason: 'Referred out: care not available on-site' },
    ],
    primary: 'Referred out: care not available on-site',
    dept: 'Orthopedics',
    consult: [
      ['Consulted at', 12.5],
      ['Seen patient at', 11.8],
      ['Replied / plan given at', 11],
    ],
    journey: [
      ['Triage', 13.8],
      ['Resus / exam room', 13.3],
      ['First physician contact', 13],
      ['Disposition decided', 10.8],
    ],
    transfer: {
      tracking: 'RCC-2026-4471',
      facility: 'Dammam Medical Complex',
      steps: [
        ['Transfer requested', 10.5],
        ['Accepted by facility', 6],
        ['RCC / transport arrived', 3],
      ],
    },
    updates: [
      { text: 'Referral faxed to RCC for hand surgery', tag: 'External transfer / fax / RCC' },
      { text: 'Accepted by DMC orthopaedics; waiting for transport', tag: 'External transfer / fax / RCC' },
    ],
    resolve: { dispo: 'TRANSFERRED', label: 'Transferred to another facility', family: 'Yes', leftH: 2.5, note: 'Left by RCC ambulance' },
  },
  {
    mrn: '99999944',
    by: 'omar',
    story: 'CTAS 3 fever and confusion, 81 years; over 24 h waiting for a medical bed',
    regH: 27,
    ctas: 3,
    dx: 'Fever and confusion, query urosepsis',
    area: 'Pooling area',
    payer: 'Government',
    shift: 'Night',
    delays: [
      { stage: 'Investigations', reason: 'Lab: delay in results release to ED' },
      { stage: 'Disposition decision', reason: 'Awaiting senior/attending sign-off' },
      { stage: 'Admission process', reason: 'No bed available on accepting ward' },
      { stage: 'Admission process', reason: 'Other', other: 'Family asking for a single room' },
    ],
    primary: 'No bed available on accepting ward',
    dept: 'Internal Medicine',
    inv: {
      type: 'Lab',
      steps: [
        ['Ordered', 26],
        ['Sample collected', 25.5],
        ['Received by lab', 24.8],
        ['Resulted', 21],
      ],
    },
    consult: [
      ['Consulted at', 20],
      ['Seen patient at', 18],
      ['Replied / plan given at', 16],
    ],
    journey: [
      ['Triage', 26.8],
      ['Resus / exam room', 26],
      ['First physician contact', 25.5],
      ['Disposition decided', 15],
    ],
    admission: [
      ['Admission order written', 14.5],
      ['Bed requested (fax sent)', 14],
      ['Bed assigned', 1.2],
    ],
    medAdminH: 3,
    updates: [
      { text: 'Medical ward full; bed manager informed', tag: 'Case / bed management' },
      { text: 'Past 24 h: escalated to the medical director', tag: 'Leadership escalation' },
      { text: 'Social worker spoke with the family about the room', tag: 'PRO / social work' },
      { text: 'Male medical bed 12 from 14:00' },
    ],
    resolve: { dispo: 'ADMITTED', label: 'Admitted', ward: /^MMW$|Male Medical/, family: 'Yes', leftH: 0.3, note: 'To male medical bed 12' },
  },
  {
    mrn: '99999945',
    by: 'omar',
    story: 'CTAS 5 hand laceration; slow registration and triage; referred to urgent care',
    regH: 5,
    ctas: 5,
    dx: 'Hand laceration, needs sutures',
    area: 'Rapid assessment zone',
    payer: 'Insured',
    shift: 'Evening',
    delays: [
      { stage: 'Registration', reason: 'Registration desk/system delay' },
      { stage: 'Triage', reason: 'Waiting for triage nurse availability' },
    ],
    primary: 'Waiting for triage nurse availability',
    journey: [
      ['Triage', 3.7],
      ['Resus / exam room', 3],
      ['First physician contact', 2.5],
      ['Disposition decided', 1.2],
    ],
    updates: [{ text: 'Registration system down for 40 minutes' }, { text: 'Triage nurse covering resus; patient waiting' }],
    resolve: { dispo: 'REFERRED_UCC', label: 'Referred to UCC', instructions: 'Yes', family: 'No', leftH: 0.7, note: 'Sutures at the urgent care centre' },
  },
]

// ---------------------------------------------------------------------------------------------

test('1. The admin creates the team', async ({ browser }) => {
  const { ctx, page } = await newSession(browser, { ...ADMIN, ip: '10.20.0.10' })
  begin('Admin signs in', 'admin')
  await page.goto('/login')
  await shot(page, 'login', { full: false })
  await signIn(page, ADMIN.username, ADMIN.password)
  await shot(page, 'board-empty')
  end(page)

  begin('Admin opens Users from the menu', 'admin')
  const menu = page.getByRole('button', { name: 'Menu' })
  if (await menu.isVisible().catch(() => false)) {
    await tap(menu)
    await shot(page, 'menu-open', { full: false })
    const admin = page.getByRole('link', { name: /Admin/ }).first()
    if (await admin.isVisible().catch(() => false)) await tap(admin)
    else note('No Admin link in the menu')
  } else note('No Menu button on the phone header')
  if (!page.url().includes('/admin')) await page.goto('/admin')
  await shot(page, 'admin-home')
  const users = page.getByRole('link', { name: 'Users', exact: true }).first()
  if (await users.isVisible().catch(() => false)) await tap(users)
  else await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible()
  await shot(page, 'admin-users-empty')
  end(page)

  for (const person of TEAM) {
    begin(`Admin creates ${person.displayName} (${person.role})`, 'admin')
    await fill(page.getByLabel('Username', { exact: true }), person.username)
    await fill(page.getByLabel('Display name', { exact: true }), person.displayName)
    await fill(page.getByLabel('Email (optional)', { exact: true }), person.email)
    await page.getByLabel('Role', { exact: true }).selectOption(person.role)
    act()
    await tap(page.getByRole('button', { name: 'Create user', exact: true }))
    const secret = page.locator('[data-temporary-password] [data-secret]')
    await expect(secret).toBeVisible()
    person.password = (await secret.innerText()).trim()
    if (person === TEAM[0]) await shot(page, 'admin-user-created', { mask: [secret] })
    await tap(page.getByRole('button', { name: 'Done', exact: true }))
    end(page)
  }
  begin('The team list', 'admin')
  await shot(page, 'admin-users-list')
  end(page)
  await ctx.close()
})

test('2. Nadia signs in for the first time and sets her own password', async ({ browser }) => {
  const nadia = staff('nadia')
  const { ctx, page } = await newSession(browser, nadia)
  begin('Nadia signs in with the temporary password and is sent to /account', 'nadia')
  await signIn(page, nadia.username, nadia.password!, '/account')
  await expect(page.locator('[data-must-change]')).toBeVisible()
  await shot(page, 'nadia-first-account')
  end(page)

  begin('Nadia changes her password at /account', 'nadia')
  await shot(page, 'account')
  const fresh = 'demo-only-nadia-password'
  await fill(page.getByLabel('Current password', { exact: true }), nadia.password!)
  await fill(page.getByLabel('New password', { exact: true }), fresh)
  await fill(page.getByLabel('New password again', { exact: true }), fresh)
  await tap(page.getByRole('button', { name: 'Change password', exact: true }))
  await page.waitForTimeout(800)
  await shot(page, 'account-changed')
  nadia.password = fresh
  nadia.changed = true
  end(page)

  begin('And now the board opens', 'nadia')
  await page.goto('/')
  await shot(page, 'nadia-first-board')
  end(page)
  await ctx.close()
})

async function openPatient(page: Page, p: Patient): Promise<void> {
  begin(`${staff(p.by).displayName} opens ${p.mrn}: ${p.story}`, p.by)
  const start = current!
  const fab = page.getByRole('link', { name: '+ New case' }).first()
  if (await fab.isVisible().catch(() => false)) await tap(fab)
  else await tap(page.getByRole('link', { name: /New case/ }).first())
  await expect(page).toHaveURL('/cases/new')
  if (p === PATIENTS[0]!) await shot(page, 'new-case-blank')
  await fill(page.getByLabel('MRN (digits only)', { exact: true }), p.mrn)
  await fill(page.getByLabel('Registration time (clock starts here)', { exact: true }), at(p.regH))
  await tap(chip(page, 'CTAS', String(p.ctas)))
  await tap(chip(page, 'ED area', p.area))
  // P13.40: the shift is a chip row in the identity block, not a select behind "More to record".
  await tap(chip(page, 'Shift', p.shift))
  await openMore(page)
  await fill(page.getByLabel('Working diagnosis (optional)', { exact: true }), p.dx)
  await tap(chip(page, 'Payer', p.payer))
  const picked = new Set<string>()
  for (const d of p.delays) {
    if (!picked.has(d.stage)) {
      await tap(page.getByRole('button', { name: d.stage, exact: true }))
      picked.add(d.stage)
    }
    await tap(chip(page, `${d.stage} reasons`, d.reason))
    if (d.other) await fill(page.getByLabel(`Other reason under ${d.stage}`, { exact: true }), d.other)
  }
  await choosePrimary(page, p.primary)
  if (p.dept) await tap(chip(page, 'Departments', p.dept))
  if (p.transfer) {
    await fill(page.getByLabel('Referral tracking number', { exact: true }), p.transfer.tracking)
    await fill(page.getByLabel('Receiving facility', { exact: true }), p.transfer.facility)
  }
  if (p === PATIENTS[0]!) await shot(page, 'new-case-filled')
  await tap(page.getByRole('button', { name: 'Open case', exact: true }))
  await expect(page).toHaveURL(/\/cases\/(?!new)[a-z0-9]+$/)
  note(`opening took ${start.actions} actions`)
  if (p === PATIENTS[0]!) await shot(page, 'case-opened')
  end(page)
}

test('3. The navigators open five patients as the delays arise', async ({ browser }) => {
  for (const who of ['nadia', 'omar']) {
    const person = staff(who)
    const { ctx, page } = await newSession(browser, person)
    begin(`${person.displayName} signs in`, who)
    await enter(page, person)
    end(page)
    for (const p of PATIENTS.filter((x) => x.by === who)) {
      await page.goto('/')
      await openPatient(page, p)
    }
    await ctx.close()
  }
})

test('4. The board at its busiest', async ({ browser }) => {
  const nadia = staff('nadia')
  const { ctx, page } = await newSession(browser, nadia)
  await signIn(page, nadia.username, nadia.password!)

  begin('The board with five open cases', 'nadia')
  await expect(page.locator('a[data-mrn]')).toHaveCount(5)
  await shot(page, 'board-five-open')
  end(page)

  begin('A row summary from the board', 'nadia')
  await tap(page.locator(`[data-summary-for="${PATIENTS[3]!.mrn}"]`))
  const dialog = page.getByRole('dialog', { name: 'Case summary' })
  await expect(dialog).toBeVisible()
  await shot(page, 'board-row-summary', { full: false })
  await tap(dialog.getByRole('button', { name: 'Close', exact: true }))
  end(page)

  begin('Filter the board to the admission delays', 'nadia')
  await tap(page.getByRole('button', { name: 'Filter' }))
  const panel = page.getByRole('dialog', { name: 'Filter cases' })
  await expect(panel).toBeVisible()
  await tap(panel.getByRole('group', { name: 'Stage' }).getByRole('button', { name: 'Admission process' }))
  await shot(page, 'filter-panel', { full: false })
  await tap(panel.getByRole('button', { name: 'Apply', exact: true }))
  await expect(page).toHaveURL(/stage=adm/)
  await shot(page, 'board-filtered')
  end(page)

  begin('The handover sheet (print preview)', 'nadia')
  await page.goto('/')
  await expect(page.locator('a[data-mrn]')).toHaveCount(5)
  await page.emulateMedia({ media: 'print' })
  await shot(page, 'handover-print')
  await page.emulateMedia({ media: 'screen' })
  end(page)
  await ctx.close()
})

async function workPatient(page: Page, p: Patient): Promise<void> {
  begin(`${staff(p.by).displayName} works ${p.mrn}: times, consults, updates`, p.by)
  await page.goto('/')
  await tap(page.locator(`a[data-mrn="${p.mrn}"]`))
  await expect(page.getByRole('heading', { name: `Case ${p.mrn}` })).toBeVisible()
  for (const [label, h] of p.journey) await time(page, label, h)
  if (p.medAdminH != null) await time(page, 'Medical admin on-call informed at', p.medAdminH)
  if (p.inv) {
    await tap(chip(page, 'Investigation types', p.inv.type))
    for (const [label, h] of p.inv.steps) await time(page, label, h)
  }
  if (p.consult) for (const [label, h] of p.consult) await time(page, label, h)
  if (p.admission) for (const [label, h] of p.admission) await time(page, label, h)
  if (p.transfer) for (const [label, h] of p.transfer.steps) await time(page, label, h)
  await save(page)
  for (const u of p.updates) await update(page, u.text, u.tag)
  if (p === PATIENTS[0]!) {
    await reopenJourney(page)
    await shot(page, 'case-worked')
  }
  end(page)

  begin(`Summary of ${p.mrn} before resolving`, p.by)
  const summaryButton = page.getByRole('button', { name: 'Summary', exact: true })
  if (await summaryButton.isVisible().catch(() => false)) {
    await tap(summaryButton)
    const dialog = page.getByRole('dialog', { name: 'Case summary' })
    await expect(dialog).toBeVisible()
    if (p === PATIENTS[0]! || p === PATIENTS[3]!) await shot(page, `summary-${p.mrn}`, { full: false })
    await tap(dialog.getByRole('button', { name: 'Close', exact: true }))
  } else note('No Summary button on the case page')
  end(page)

  begin(`${staff(p.by).displayName} resolves ${p.mrn} as ${p.resolve.label}`, p.by)
  await page.getByRole('combobox', { name: /^Final disposition/ }).selectOption(p.resolve.dispo)
  act()
  if (p.resolve.ward) await tap(chip(page, 'Ward', p.resolve.ward))
  if (p.resolve.instructions) await tap(chip(page, 'Instructions given by doctor', p.resolve.instructions))
  if (p.resolve.family) await tap(chip(page, 'Family engaged', p.resolve.family))
  await fill(page.getByLabel('Left ED', { exact: true }), at(p.resolve.leftH))
  await fill(page.getByLabel('Resolution note (optional)', { exact: true }), p.resolve.note)
  if (p === PATIENTS[0]!) await shot(page, 'resolve-filled')
  await tap(page.getByRole('button', { name: 'Mark resolved', exact: true }))
  await expect(page.getByText(`Resolved: ${p.resolve.label}`)).toBeVisible()
  if (p === PATIENTS[0]! || p === PATIENTS[3]!) await shot(page, `resolved-${p.mrn}`)
  end(page)
}

test('5. The navigators work each case and resolve it', async ({ browser }) => {
  for (const who of ['nadia', 'omar']) {
    const person = staff(who)
    const { ctx, page } = await newSession(browser, person)
    await enter(page, person)
    for (const p of PATIENTS.filter((x) => x.by === who)) await workPatient(page, p)
    await ctx.close()
  }
})

test('6. Sara, the charge nurse, reviews and exports', async ({ browser }) => {
  const sara = staff('sara')
  const { ctx, page } = await newSession(browser, sara)
  begin('Sara signs in', 'sara')
  await enter(page, sara)
  await shot(page, 'sara-board-empty-open-tab')
  end(page)

  begin('The Resolved tab', 'sara')
  await tap(page.getByRole('link', { name: 'Resolved', exact: true }).or(page.getByRole('button', { name: 'Resolved', exact: true })).first())
  await expect(page.locator('a[data-mrn]')).toHaveCount(5)
  await shot(page, 'board-resolved')
  end(page)

  for (const p of [PATIENTS[0]!, PATIENTS[3]!, PATIENTS[2]!]) {
    begin(`Sara marks ${p.mrn} reviewed`, 'sara')
    await page.goto('/?f=resolved')
    await tap(page.locator(`a[data-mrn="${p.mrn}"]`))
    await tap(page.getByRole('button', { name: 'Mark reviewed', exact: true }))
    await expect(page.getByText(`Reviewed by ${sara.displayName}`, { exact: false })).toBeVisible()
    if (p === PATIENTS[0]!) await shot(page, 'reviewed', { full: false })
    end(page)
  }

  begin('Export: the page and the workbook', 'sara')
  await page.goto('/')
  const exportTab = page.getByRole('link', { name: 'Export', exact: true }).first()
  if (await exportTab.isVisible().catch(() => false)) await tap(exportTab)
  else await page.goto('/export')
  await expect(page).toHaveURL(/\/export/)
  await shot(page, 'export')
  const download = page.getByRole('link', { name: /Download/ }).first()
  if (await download.isVisible().catch(() => false)) {
    const [file] = await Promise.all([page.waitForEvent('download'), download.click()])
    act()
    await file.saveAs(join(SHOTS, file.suggestedFilename()))
    note(`workbook ${file.suggestedFilename()}`)
  } else note('No Download link found')
  end(page)

  begin('The printable report', 'sara')
  const report = page.getByRole('link', { name: /report/i }).first()
  const href = (await report.getAttribute('href').catch(() => null)) ?? '/report'
  await page.goto(href)
  await shot(page, 'report-phone')
  end(page)
  await ctx.close()
})

test('7. Dr Huda reads the dashboard on her phone and on her laptop', async ({ browser }) => {
  const huda = staff('huda')
  const phone = await newSession(browser, huda)
  let page = phone.page
  begin('Dr Huda signs in (read-only)', 'huda')
  await enter(page, huda)
  await expect(page.getByRole('link', { name: '+ New case' })).toHaveCount(0)
  end(page)

  begin('The dashboard on the phone', 'huda')
  const dash = page.getByRole('link', { name: 'Dashboard', exact: true }).first()
  if (await dash.isVisible().catch(() => false)) await tap(dash)
  else await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)
  await shot(page, 'dashboard-phone')
  end(page)

  begin('A drill-down from Where the time goes', 'huda')
  const drill = page.locator('a[href*="drill=phase"]').first()
  if (await drill.isVisible().catch(() => false)) {
    await tap(drill)
    await shot(page, 'dashboard-drill-phase')
  } else note('No phase drill link visible')
  end(page)

  begin('A read-only case', 'huda')
  await page.goto('/?f=all')
  await tap(page.locator(`a[data-mrn="${PATIENTS[1]!.mrn}"]`))
  await shot(page, 'case-read-only')
  end(page)
  await phone.ctx.close()

  const laptop = await newSession(browser, { ...huda, ip: '10.20.0.15' }, true)
  page = laptop.page
  begin('The dashboard on the laptop', 'huda')
  await signIn(page, huda.username, huda.password!)
  await shot(page, 'laptop-board-all', { full: false })
  await page.goto('/dashboard')
  await shot(page, 'dashboard-laptop')
  end(page)
  begin('The board on the laptop (All tab)', 'huda')
  await page.goto('/?f=all')
  await shot(page, 'laptop-board')
  end(page)
  await laptop.ctx.close()
})
