import { defineConfig, devices } from '@playwright/test'
import { assertDemoTarget } from '../../src/lib/demo-guard'

/**
 * The hands-on demo (Phase 11): the production build over a fresh demo database, a phone first.
 * Not part of the chain. `bash scripts/demo-reset.sh`, start the app on :3300 against the demo
 * database (see docs/RUNBOOK.md, "Hands-on demo"), then
 * `pnpm exec playwright test --config tests/demo/playwright.demo.config.ts`.
 *
 * Phase 12 item 2 (D3): the base URL is checked before anything is configured. This kit signs in,
 * creates staff accounts and opens cases; pointed at production by a stray `DEMO_BASE_URL` it
 * would put invented patients on the real record permanently, because the audit log is
 * append-only and a case can only be voided.
 */
const baseURL = process.env.DEMO_BASE_URL ?? 'http://localhost:3300'
assertDemoTarget(baseURL)

export default defineConfig({
  testDir: '.',
  testMatch: /demo\.spec\.ts$/,
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: '../../test-results/demo',
  use: {
    baseURL,
    timezoneId: 'Asia/Riyadh',
    locale: 'en-GB',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 14'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
})
