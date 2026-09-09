import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTs,
  // `dist/**` is the esbuild bundle of worker/alerts.ts — generated, and the sources it inlines
  // are already linted (or are third-party). Everything else here is likewise not ours.
  {
    ignores: [
      '.next/**',
      'dist/**',
      'node_modules/**',
      'docs/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.claude/**',
    ],
  },
]
export default config
