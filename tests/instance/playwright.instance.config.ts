import { defineConfig, devices } from '@playwright/test'

/**
 * The demo shape of the instance banner (Phase 12 item 1, D6): the *same* production build,
 * started a second time with `INSTANCE_LABEL=DEMO` on port 3401.
 *
 * Not in CI — it costs a second server — but run by hand and at the Phase 12 gate, and named in
 * docs/RUNBOOK.md's demo section. `pnpm build` first, then:
 *   `pnpm exec playwright test --config tests/instance/playwright.instance.config.ts`
 *
 * The variable is set through Playwright's `env` option and never as a shell prefix, so the
 * command line is the same on Windows and on Linux.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /instance(-screenshots)?\.spec\.ts$/,
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  outputDir: '../../test-results/instance',
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3401/api/health',
    // Both new variables at once: this is the demo instance's shape, and item 8's raised login
    // limit can only be observed on a server that was started with it.
    env: { INSTANCE_LABEL: 'DEMO', LOGIN_RATE_LIMIT_PER_MINUTE: '60', PORT: '3401' },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: { baseURL: 'http://localhost:3401', trace: 'on-first-retry' },
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
