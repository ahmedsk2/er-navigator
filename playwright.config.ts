import { defineConfig, devices } from '@playwright/test'

// Mobile-first: the primary project is a 390 x 844 phone (plan section 5), the second is desktop.
// Both run on Chromium so CI and the gate screenshots need one browser download. The iPhone
// device descriptor is used for its UA/scale/touch emulation, with the engine pinned to Chromium.
//
// The web server: `pnpm start` serves the normal (non-standalone) production build. Run
// `pnpm build` first; CI does. Set E2E_BASE_URL to test an already-running server instead.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  // Seeds the one fixture the UI cannot make: an already-locked account. Needs DATABASE_URL,
  // which this suite needs anyway.
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
