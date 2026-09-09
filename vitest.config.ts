import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * tests/db/** talk to a real Postgres (migrations applied, owner role). They are included only
 * when DATABASE_URL is set, so `pnpm test` on a laptop with no database — and the CI `verify`
 * job, which has none — runs the unit suite and passes. tests/db/global-setup.ts fails loudly
 * if DATABASE_URL is set but the schema is not migrated, so a silent skip is impossible.
 */
const dbTests = process.env.DATABASE_URL ? ['tests/db/**/*.test.ts'] : []

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '.next/**', '.claude/**'],
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', ...dbTests],
    globalSetup: ['tests/db/global-setup.ts'],
    coverage: { provider: 'v8', include: ['src/**'] },
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
