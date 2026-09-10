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
    await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()

    // Phase 3 moved the name and Log out from the header bar into the overflow menu.
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('menuitem', { name: `${ADMIN_DISPLAY_NAME} · Admin` })).toBeVisible()
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

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
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

/**
 * The Phase 9 sign-in (Ahmed's direction A of 10 September). Every selector the specs above use
 * is unchanged; what is new is geometry, and geometry is the one thing a class name cannot
 * prove. Both facts are asserted at the real viewport: the hero is there on the phone and on the
 * desktop, and on the desktop the form card sits in the right-hand column rather than centred.
 */
test.describe('the sign-in screen', () => {
  test('leads with the hero, and on desktop puts the form card in the right half', async ({ page }, testInfo) => {
    await fromClientIp(page, '198.51.100.41')
    await page.goto('/login')

    await expect(page.locator('[data-login-hero]')).toBeVisible()
    // The hero wordmark is the page's one "ER Navigator" heading; the gate and smoke specs
    // select it by name and a second one would make them ambiguous.
    await expect(page.getByRole('heading', { name: 'ER Navigator' })).toHaveCount(1)

    const card = page.locator('[data-login-card]')
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    if (testInfo.project.name === 'desktop') {
      expect(box.x).toBeGreaterThan(600)
    } else {
      // On the phone the card is the sheet's content: full width, below the hero.
      expect(box.x).toBeLessThan(60)
      expect(box.y).toBeGreaterThan(240)
    }
  })

  test('the password can be revealed and hidden, and the toggle is not a second "Password"', async ({ page }) => {
    await fromClientIp(page, '198.51.100.42')
    await page.goto('/login')

    const password = page.getByLabel('Password', { exact: true })
    await password.fill('not-the-real-one')
    await expect(password).toHaveAttribute('type', 'password')

    const show = page.getByRole('button', { name: 'Show password' })
    await expect(show).toHaveAttribute('aria-pressed', 'false')
    await show.click()
    await expect(password).toHaveAttribute('type', 'text')

    const hide = page.getByRole('button', { name: 'Hide password' })
    await expect(hide).toHaveAttribute('aria-pressed', 'true')
    await hide.click()
    await expect(password).toHaveAttribute('type', 'password')
    // The typed value survives the round trip: the toggle must not remount the input.
    await expect(password).toHaveValue('not-the-real-one')
  })
})
