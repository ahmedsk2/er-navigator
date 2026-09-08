import { expect, test } from '@playwright/test'

test('holding page renders and health responds', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ER Navigator' })).toBeVisible()
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(res.headers()['x-build-fingerprint']).toMatch(/^[0-9a-f]{16}$/)
})
