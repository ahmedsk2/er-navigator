import { expect, type Page } from '@playwright/test'
import type { E2EUser } from './seed-users'

/** A case id, never `/cases/new`. */
export const CASE_URL = /\/cases\/(?!new)[a-z0-9]+$/

/**
 * The login form is rate limited to five attempts a minute per client IP, so every browser
 * context in this suite declares its own — which is also what happens in the ward, where each
 * phone has its own address.
 */
export async function fromClientIp(page: Page, ip: string): Promise<void> {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': ip })
}

/**
 * Counts the taps and keystrokes a nurse actually makes, so "opening a case takes under 15 UI
 * actions" is measured rather than asserted. One `fill` is one action: on a phone it is one tap
 * into the field and one entry.
 */
export class Taps {
  count = 0

  async fill(page: Page, label: string, value: string): Promise<void> {
    this.count += 1
    await page.getByLabel(label, { exact: true }).fill(value)
  }

  async press(page: Page, label: string, key: string): Promise<void> {
    this.count += 1
    await page.getByLabel(label, { exact: true }).press(key)
  }

  async click(page: Page, name: string): Promise<void> {
    this.count += 1
    await page.getByRole('button', { name, exact: true }).click()
  }

  async clickLink(page: Page, name: string): Promise<void> {
    this.count += 1
    await page.getByRole('link', { name, exact: true }).click()
  }

  async select(page: Page, label: string, value: string): Promise<void> {
    this.count += 1
    await page.getByLabel(label, { exact: true }).selectOption(value)
  }
}

export async function signIn(page: Page, user: E2EUser, taps = new Taps()): Promise<Taps> {
  await page.goto('/login')
  await taps.fill(page, 'Username', user.username)
  await taps.fill(page, 'Password', user.password)
  await taps.click(page, 'Sign in')
  await expect(page).toHaveURL('/')
  return taps
}

/** The shortest real path to an open case: home -> New case -> MRN -> stage -> reason -> save. */
export async function openCase(
  page: Page,
  mrn: string,
  stage: string,
  reason: string,
  taps: Taps,
): Promise<string> {
  await taps.clickLink(page, 'New case')
  await expect(page).toHaveURL('/cases/new')
  await taps.fill(page, 'MRN (digits only)', mrn)
  await taps.click(page, stage)
  await taps.click(page, reason)
  await taps.click(page, 'Open case')
  await expect(page).toHaveURL(CASE_URL)
  return page.url()
}

/** A fresh MRN per test run, so an assertion can never match a case an earlier run left behind. */
export function uniqueMrn(): string {
  return String(700000 + Math.floor(Math.random() * 299999))
}
