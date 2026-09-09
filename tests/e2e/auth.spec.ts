import { expect, test, type Page } from '@playwright/test'
import { LOCKED_PASSWORD, LOCKED_USERNAME } from './global-setup'

/**
 * The admin the seed creates from env. CI sets these; a local run uses the same values
 * (see the Phase 1 verification steps in docs/CHANGELOG.md).
 */
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ci-only-password'
const ADMIN_DISPLAY_NAME = process.env.E2E_ADMIN_DISPLAY_NAME ?? 'CI'

/**
 * The login form is rate limited to 5 attempts per minute per client IP, and this suite makes
 * more than that across two projects. Each test declares its own client IP so it gets its own
 * bucket — which is also what happens in the ward, where every phone has its own address.
 */
async function fromClientIp(page: Page, ip: string): Promise<void> {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': ip })
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Sign in and wait for the board, so a following goto() cannot race the cookie. */
async function signInAndLand(page: Page, username: string, password: string): Promise<void> {
  await signIn(page, username, password)
  await expect(page).toHaveURL('/')
}

test.describe('the route gate', () => {
  test('sends a signed-out visitor from the board to the login form', async ({ page }) => {
    await fromClientIp(page, '198.51.100.11')
    await page.goto('/')
    await expect(page).toHaveURL(/\/login\?next=%2F$/)
    await expect(page.getByRole('heading', { name: 'ER Navigator' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
  })

  test('sends a signed-out visitor from /account to the login form, remembering where they were', async ({ page }) => {
    await fromClientIp(page, '198.51.100.12')
    await page.goto('/account')
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/)
  })
})

test.describe('signing in', () => {
  test('a wrong password says so, without saying whether the username exists', async ({ page }) => {
    await fromClientIp(page, '198.51.100.21')
    await signIn(page, ADMIN_USERNAME, 'definitely-not-the-password')
    await expect(page.getByText('Wrong username or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('an unknown username gets the same message', async ({ page }) => {
    await fromClientIp(page, '198.51.100.22')
    await signIn(page, 'nobody_at_all', 'definitely-not-the-password')
    await expect(page.getByText('Wrong username or password.')).toBeVisible()
  })

  test('the right password lands on the board and shows who is signed in', async ({ page }) => {
    await fromClientIp(page, '198.51.100.23')
    await signIn(page, ADMIN_USERNAME, ADMIN_PASSWORD)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'ER Navigator' })).toBeVisible()
    await expect(page.getByRole('link', { name: `${ADMIN_DISPLAY_NAME} · Admin` })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Elapsed-time bands' })).toBeVisible()
  })

  test('a locked account is told to wait, not that the password was wrong', async ({ page }) => {
    await fromClientIp(page, '198.51.100.24')
    await signIn(page, LOCKED_USERNAME, LOCKED_PASSWORD)
    await expect(page.getByText(/^Too many attempts\. Try again in \d+ minutes?\.$/)).toBeVisible()
  })

  test('signing in again on the same browser goes to the board, not the form', async ({ page }) => {
    await fromClientIp(page, '198.51.100.25')
    await signIn(page, ADMIN_USERNAME, ADMIN_PASSWORD)
    await expect(page).toHaveURL('/')
    await page.goto('/login')
    await expect(page).toHaveURL('/')
  })
})

test.describe('signed in', () => {
  test('logging out returns to the login form and the board is closed again', async ({ page }) => {
    await fromClientIp(page, '198.51.100.31')
    await signIn(page, ADMIN_USERNAME, ADMIN_PASSWORD)
    await expect(page).toHaveURL('/')

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL('/login')
    await expect(page.getByLabel('Username')).toBeVisible()

    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/account refuses a new password under twelve characters', async ({ page }) => {
    await fromClientIp(page, '198.51.100.32')
    await signInAndLand(page, ADMIN_USERNAME, ADMIN_PASSWORD)
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()

    await page.getByLabel('Current password').fill(ADMIN_PASSWORD)
    await page.getByLabel('New password', { exact: true }).fill('short')
    await page.getByLabel('New password again').fill('short')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('Use at least 12 characters for the new password.')).toBeVisible()
  })

  test('/account refuses two new passwords that do not match', async ({ page }) => {
    await fromClientIp(page, '198.51.100.33')
    await signInAndLand(page, ADMIN_USERNAME, ADMIN_PASSWORD)
    await page.goto('/account')

    await page.getByLabel('Current password').fill(ADMIN_PASSWORD)
    await page.getByLabel('New password', { exact: true }).fill('a-long-enough-password')
    await page.getByLabel('New password again').fill('a-different-long-password')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('The two new passwords do not match.')).toBeVisible()
  })
})
