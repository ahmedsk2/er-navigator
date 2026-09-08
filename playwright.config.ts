import { defineConfig, devices } from '@playwright/test'

// Mobile-first: the primary project is a 390 x 844 phone (plan section 5), the second is desktop.
// Both run on Chromium so CI and the gate screenshots need one browser download. The iPhone
// device descriptor is used for its UA/scale/touch emulation, with the engine pinned to Chromium.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
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
