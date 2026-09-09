import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/db'
import {
  ALERT_MRN,
  ALERT_THRESHOLD_HOURS,
  EDITOR_ALERT_MRN,
  EDITOR_ALERT_THRESHOLD_HOURS,
  PROMOTE_MRN,
  PROMOTE_TEXT,
} from './fixtures/admin-cases'
import { fromClientIp, signIn } from './fixtures/case-flow'
import { E2E_TEMP_USER_PREFIX, E2E_USERS } from './fixtures/seed-users'

/**
 * The Phase 6 slice through the browser: an administrator creates a user, that user signs in with
 * the one-time password, the administrator deactivates them and they cannot sign in any more;
 * a queued "Other" description is promoted and the case it came from is re-tagged; an alert is
 * acknowledged both from `/admin/alerts` and from the case editor's header.
 *
 * Administration is a laptop screen, so the spec runs desktop only. Serial, because the specs
 * share one database and these tests change reference data other tests read.
 */
test.describe.configure({ mode: 'serial' })

const DESKTOP_ONLY = 'administration is done on a laptop; the spec runs desktop'

test.afterAll(async () => {
  await prisma.$disconnect()
})

function temporaryUsername(): string {
  return `${E2E_TEMP_USER_PREFIX}${randomBytes(4).toString('hex')}`
}

test('an admin creates a user, that user signs in, and deactivating them locks them out', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.101')
  await signIn(page, E2E_USERS.admin)

  // The Admin tab is offered to an ADMIN.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Admin' }).click()
  await expect(page).toHaveURL('/admin')
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()

  await page.getByRole('link', { name: 'Users', exact: true }).click()
  await expect(page).toHaveURL('/admin/users')

  const username = temporaryUsername()
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Display name', { exact: true }).fill('Temporary Nurse')
  await page.getByLabel('Email (optional)', { exact: true }).fill(`${username}@hospital.example`)
  await page.getByLabel('Role', { exact: true }).selectOption('NAVIGATOR')
  await page.getByRole('button', { name: 'Create user', exact: true }).click()

  // The temporary password is shown exactly once, and it is what the new account signs in with.
  const secret = page.locator('[data-temporary-password] [data-secret]')
  await expect(secret).toBeVisible()
  const password = (await secret.innerText()).trim()
  expect(password).toHaveLength(16)
  await expect(page.locator(`[data-user="${username}"]`)).toBeVisible()

  // The work email is the alerts directory (Phase 7): set on create, changed and cleared here.
  const row = page.locator(`[data-user="${username}"]`)
  await expect(row.locator('td[data-email]')).toHaveAttribute(
    'data-email',
    `${username}@hospital.example`,
  )
  await row.getByRole('textbox', { name: `Email for ${username}` }).fill(`${username}.new@hospital.example`)
  await row.getByRole('button', { name: `Save the email for ${username}` }).click()
  await expect(row.locator('td[data-email]')).toHaveAttribute(
    'data-email',
    `${username}.new@hospital.example`,
  )
  await row.getByRole('textbox', { name: `Email for ${username}` }).fill('')
  await row.getByRole('button', { name: `Save the email for ${username}` }).click()
  await expect(row.locator('td[data-email]')).toHaveAttribute('data-email', '')

  const theirs = await browser.newContext()
  const their = await theirs.newPage()
  await fromClientIp(their, '198.51.100.102')
  await their.goto('/login')
  await their.getByLabel('Username').fill(username)
  await their.getByLabel('Password').fill(password)
  await their.getByRole('button', { name: 'Sign in' }).click()
  await expect(their).toHaveURL('/')

  // Deactivating ends the session on the spot: the next request goes to the login screen.
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page
    .locator(`[data-user="${username}"]`)
    .getByRole('button', { name: 'Deactivate', exact: true })
    .click()
  await expect(page.locator(`[data-user="${username}"] [data-active="no"]`)).toBeVisible()

  await their.goto('/')
  await expect(their).toHaveURL(/\/login/)

  // And they cannot sign in again.
  await their.getByLabel('Username').fill(username)
  await their.getByLabel('Password').fill(password)
  await their.getByRole('button', { name: 'Sign in' }).click()
  await expect(their.getByRole('alert')).toBeVisible()
  await expect(their).toHaveURL(/\/login/)
  await theirs.close()
})

test('an admin cannot deactivate or demote themselves', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.103')
  await signIn(page, E2E_USERS.admin)
  await page.goto('/admin/users')

  const own = page.locator(`[data-user="${E2E_USERS.admin.username}"]`)
  await expect(own.getByRole('button', { name: 'Deactivate', exact: true })).toBeDisabled()
  // Their own role is text, not a control.
  await expect(own.getByRole('combobox')).toHaveCount(0)

  // The system account offers nothing at all.
  await expect(page.locator('[data-user="system"]')).toContainText('Automatic account')
})

test('promoting an Other description re-tags the case it came from', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.104')
  await signIn(page, E2E_USERS.admin)

  await page.goto('/admin/other')
  const row = page.locator(`[data-other-review="${PROMOTE_TEXT}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText(PROMOTE_MRN)

  // The name box defaults to the wording the nurse typed.
  await expect(row.getByLabel('Name for the new reason')).toHaveValue(PROMOTE_TEXT)
  await row.getByRole('button', { name: 'Promote', exact: true }).click()

  await expect(page.getByRole('status')).toContainText(`re-tagged MRN ${PROMOTE_MRN}`)
  await expect(page.locator(`[data-other-review="${PROMOTE_TEXT}"]`)).toHaveCount(0)

  // The case now carries the promoted reason instead of the Other text.
  const promoted = await prisma.case.findFirstOrThrow({
    where: { mrn: PROMOTE_MRN },
    select: {
      primaryReason: { select: { name: true, isOther: true } },
      reasons: { select: { otherText: true, reason: { select: { name: true } } } },
    },
  })
  expect(promoted.primaryReason?.name).toBe(PROMOTE_TEXT)
  expect(promoted.primaryReason?.isOther).toBe(false)
  expect(promoted.reasons.map((r) => r.reason.name)).toEqual([PROMOTE_TEXT])
  expect(promoted.reasons[0]!.otherText).toBeNull()

  // And the new reason is on the stage's list, where the case editor's chips come from.
  await page.goto('/admin/lists')
  await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Admission process' })
  await expect(page.locator(`[data-list-item="${PROMOTE_TEXT}"]`)).toBeVisible()
})

test('an admin acknowledges an alert from the admin screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.105')
  await signIn(page, E2E_USERS.admin)

  await page.goto('/admin/alerts')
  const alert = await prisma.alert.findFirstOrThrow({
    where: { case: { mrn: ALERT_MRN }, thresholdHours: ALERT_THRESHOLD_HOURS },
    select: { id: true },
  })
  const row = page.locator(`[data-alert="${alert.id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText(`${ALERT_THRESHOLD_HOURS}h`)
  await expect(row.locator('[data-acknowledged="no"]')).toBeVisible()

  await row.getByRole('button', { name: /^Acknowledge/ }).click()
  await expect(page.locator(`[data-alert="${alert.id}"] [data-acknowledged="yes"]`)).toBeVisible()
  await expect(page.locator(`[data-alert="${alert.id}"]`)).toContainText(E2E_USERS.admin.displayName)

  const stored = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })
  expect(stored.acknowledgedAt).not.toBeNull()

  // Acknowledging is audited.
  const audits = await prisma.auditLog.findMany({
    where: { entity: 'Alert', entityId: alert.id, action: 'alert.acknowledge' },
  })
  expect(audits).toHaveLength(1)
})

test('a supervisor acknowledges from the case editor, and a navigator is never offered it', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)

  // Its own fixture case, so this never depends on what the /admin/alerts test acknowledged.
  const target = await prisma.case.findFirstOrThrow({
    where: { mrn: EDITOR_ALERT_MRN },
    select: { id: true },
  })

  // The navigator who opened it sees no banner: acknowledging is SUPERVISOR and ADMIN.
  const nurseContext = await browser.newContext()
  const nurse = await nurseContext.newPage()
  await fromClientIp(nurse, '198.51.100.106')
  await signIn(nurse, E2E_USERS.navigator)
  await nurse.goto(`/cases/${target.id}`)
  await expect(nurse.getByRole('heading', { name: `Case ${EDITOR_ALERT_MRN}` })).toBeVisible()
  await expect(nurse.locator('[data-alert-banner]')).toHaveCount(0)
  await expect(nurse.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await nurseContext.close()

  await fromClientIp(page, '198.51.100.107')
  await signIn(page, E2E_USERS.supervisor)
  await page.goto(`/cases/${target.id}`)
  const banner = page.locator('[data-alert-banner]')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(`${EDITOR_ALERT_THRESHOLD_HOURS}h`)
  await banner.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.locator('[data-alert-banner]')).toHaveCount(0)

  const stored = await prisma.alert.findFirstOrThrow({
    where: { caseId: target.id, thresholdHours: EDITOR_ALERT_THRESHOLD_HOURS },
  })
  expect(stored.acknowledgedAt).not.toBeNull()
})

test('the audit log lists what the admin did, filtered', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.108')
  await signIn(page, E2E_USERS.admin)

  await page.goto('/admin/audit?action=user.create')
  await expect(page.locator('[data-audit-total]')).toContainText('page 1 of')
  const rows = page.locator('[data-audit-row="user.create"]')
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(rows.first()).toContainText('username')

  // A filter nothing matches is an empty table, not an error.
  await page.goto('/admin/audit?action=user.create&from=1999-01-01&to=1999-01-02')
  await expect(page.locator('[data-audit-total]')).toContainText('0 rows')
})

test('nobody but an admin can reach /admin, and the tab is not offered', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
  await fromClientIp(page, '198.51.100.109')
  await signIn(page, E2E_USERS.supervisor)

  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Admin' }),
  ).toHaveCount(0)

  for (const path of ['/admin', '/admin/users', '/admin/lists', '/admin/other', '/admin/alerts', '/admin/audit']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible()
  }
})
