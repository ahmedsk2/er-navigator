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

/** The shortest real path to an open case: the board's FAB -> MRN -> stage -> reason -> save. */
export async function openCase(
  page: Page,
  mrn: string,
  stage: string,
  reason: string,
  taps: Taps,
): Promise<string> {
  await taps.clickLink(page, '+ New case')
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

/**
 * Phase 13. The five answers a navigator fills in when writing the case up — the shift, the
 * working diagnosis, the payer, pain management and case management — are behind "More to
 * record", closed on a case that carries none of them. Idempotent, so a spec can call it on a
 * case that opened it by itself.
 */
export async function openMoreToRecord(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'More to record', exact: true })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Phase 13, decision C: the journey times each outcome cannot be resolved without, by the label
 * the "Patient journey" block shows. `recordJourney` taps each step's Now, which is what a nurse
 * at the desk does; every step lands on the same instant, and equal times are in order.
 */
export const DISCHARGE_JOURNEY = ['Triage', 'First physician contact', 'Disposition decided', 'Left ED'] as const
export const ADMISSION_JOURNEY = [
  'Triage',
  'First physician contact',
  'Disposition decided',
  'Admission order written',
  'Bed assigned',
  'Left ED',
] as const
export const TRANSFER_JOURNEY = [
  'Triage',
  'First physician contact',
  'Disposition decided',
  'Transfer requested',
  'Accepted by facility',
  'Left ED',
] as const

export async function recordJourney(page: Page, steps: ReadonlyArray<string>): Promise<void> {
  for (const label of steps) {
    await page.getByRole('button', { name: `Now — ${label}`, exact: true }).click()
  }
}
