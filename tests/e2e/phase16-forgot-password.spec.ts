import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { forgotUserFor, seedExpiredToken, tokenFromOutbox } from './fixtures/forgot'

/**
 * Phase 16 (docs/specs/phase16-forgot-password.md), at 390 x 844 and 1280 x 800.
 *
 * The claim these earn is the one the login page now makes to a nurse at 2 a.m.: tap the link,
 * type your username or the address on your account, open what arrives, and sign in with the
 * password you chose. Nothing here
 * shortcuts the app — the token is read out of the `Outbox` row the app itself wrote, which is
 * exactly the string the mail carries, and the sign-in at the end is the real form.
 *
 * Each test declares its own client IP: /forgot and /reset are rate limited to five a minute per
 * address, like the sign-in form, and this file makes more than that across two projects. The
 * RETRY index is part of the address too — the flow below spends four of the five, so a CI retry
 * from the same address inside the same minute would be refused for the wrong reason and hide
 * whatever made the first attempt fail.
 */
const MESSAGE = 'If that account has an email, a link is on its way. It works for 30 minutes.'
const DEAD = 'That link does not work any more. Links last 30 minutes and can be used once.'

async function fromClientIp(page: Page, testInfo: TestInfo, n: number): Promise<void> {
  const project = testInfo.project.name === 'mobile' ? 0 : 8
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `203.0.113.${120 + project + n + testInfo.retry * 20}`,
  })
}

/** The page must never scroll sideways on a phone (plan section 5). */
async function expectNoSidewaysScroll(page: Page, testInfo: { project: { name: string } }): Promise<void> {
  if (testInfo.project.name !== 'mobile') return
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways at 390').toBeLessThanOrEqual(0)
}

/** The one field takes a username or the address on the account (P16.42). */
async function ask(page: Page, identifier: string): Promise<void> {
  await page.goto('/forgot')
  await page.getByLabel('Username or email', { exact: true }).fill(identifier)
  await page.getByRole('button', { name: 'Send the link', exact: true }).click()
  await expect(page.locator('[data-reset-requested]')).toHaveText(MESSAGE)
}

test.describe('the way in when the password is gone', () => {
  test('the login page carries the link, and it goes to /forgot', async ({ page }, testInfo) => {
    await fromClientIp(page, testInfo, 0)
    await page.goto('/login')

    const link = page.getByRole('link', { name: 'Forgot your password?', exact: true })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL('/forgot')
    await expect(page.getByRole('heading', { name: 'ER Navigator' })).toBeVisible()
    await expect(page.getByLabel('Username or email', { exact: true })).toBeVisible()
    await expectNoSidewaysScroll(page, testInfo)
  })

  test('an account that exists and one that does not get exactly the same answer', async ({
    page,
  }, testInfo) => {
    await fromClientIp(page, testInfo, 1)
    const user = forgotUserFor(testInfo.project.name)

    await ask(page, 'nobody_at_all_p16')
    const unknown = await page.locator('[data-reset-requested]').innerText()

    await ask(page, user.username)
    const known = await page.locator('[data-reset-requested]').innerText()

    expect(known).toBe(unknown)
    expect(known).toBe(MESSAGE)
    await expectNoSidewaysScroll(page, testInfo)
  })

  test('the link in the mail sets a password that signs in', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile'
    await fromClientIp(page, testInfo, 2)
    const user = forgotUserFor(testInfo.project.name)

    // 1. Ask — with the EMAIL ADDRESS, which is what Ahmed typed on 13 September and what the
    //    field takes since P16.42 — and read what the app put in the outbox for that address,
    //    which is the same string the worker would put in the mail.
    await ask(page, user.email.toUpperCase())
    const token = await tokenFromOutbox(user.email)

    // 2. Open the link. It says nothing about the account: no username anywhere on the page.
    await page.goto(`/reset?token=${encodeURIComponent(token)}`)
    await expect(page.getByRole('heading', { name: 'ER Navigator' })).toBeVisible()
    await expect(page.getByText('Set a new password', { exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(user.username)
    await expectNoSidewaysScroll(page, testInfo)

    // 3. Under twelve characters is refused, by the rule /account uses.
    await page.getByLabel('New password', { exact: true }).fill('short')
    await page.getByLabel('New password again', { exact: true }).fill('short')
    await page.getByRole('button', { name: 'Set the new password', exact: true }).click()
    await expect(page.locator('[data-reset-error]')).toHaveText(
      'Use at least 12 characters for the new password.',
    )

    // 4. Two that do not match are refused too.
    await page.getByLabel('New password', { exact: true }).fill('a-long-enough-password')
    await page.getByLabel('New password again', { exact: true }).fill('a-different-long-one')
    await page.getByRole('button', { name: 'Set the new password', exact: true }).click()
    await expect(page.locator('[data-reset-error]')).toHaveText('The two new passwords do not match.')

    // 5. A good one lands on the sign-in form with the notice.
    const chosen = mobile ? 'phone-password-of-their-own' : 'laptop-password-of-their-own'
    await page.getByLabel('New password', { exact: true }).fill(chosen)
    await page.getByLabel('New password again', { exact: true }).fill(chosen)
    await page.getByRole('button', { name: 'Set the new password', exact: true }).click()
    await expect(page).toHaveURL('/login?reset=1')
    await expect(page.locator('[data-password-reset]')).toHaveText('Password changed. Sign in.')

    // 6. It works, and it does not send them to /account: they chose this password themselves.
    await page.getByLabel('Username', { exact: true }).fill(user.username)
    await page.getByLabel('Password', { exact: true }).fill(chosen)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'ER board' })).toBeVisible()

    // 7. The same link a second time is refused, with the one sentence.
    await page.goto(`/reset?token=${encodeURIComponent(token)}`)
    await expect(page.locator('[data-reset-dead]')).toHaveText(DEAD)
  })

  test('an expired link is refused, and offers a new one', async ({ page }, testInfo) => {
    await fromClientIp(page, testInfo, 3)
    const user = forgotUserFor(testInfo.project.name)
    const token = await seedExpiredToken(user.username)

    await page.goto(`/reset?token=${encodeURIComponent(token)}`)
    await expect(page.locator('[data-reset-dead]')).toHaveText(DEAD)
    // No form to type into, and no way to tell an expired link from one that never existed.
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0)
    await page.goto('/reset?token=a-token-nobody-ever-issued')
    await expect(page.locator('[data-reset-dead]')).toHaveText(DEAD)
    await expectNoSidewaysScroll(page, testInfo)

    await page.getByRole('link', { name: 'Ask for a new link', exact: true }).click()
    await expect(page).toHaveURL('/forgot')
  })
})
