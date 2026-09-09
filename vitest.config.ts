import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.next/**', '.claude/**'],
    coverage: { provider: 'v8', include: ['src/**'] },
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
