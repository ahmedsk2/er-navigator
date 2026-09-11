import { defineConfig, devices } from '@playwright/test'

/**
 * The hands-on demo (Phase 11): the production build over a fresh demo database, a phone first.
 * Not part of the chain. `bash scripts/demo-reset.sh`, start the app on :3300 against the demo
 * database (see docs/RUNBOOK.md, "Hands-on demo"), then
 * `pnpm exec playwright test --config tests/demo/playwright.demo.config.ts`.
 */
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
    baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:3300',
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
