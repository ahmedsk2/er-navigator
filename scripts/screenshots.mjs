// Gate screenshots at the two plan viewports. Usage:
//   node scripts/screenshots.mjs <label> [baseUrl] [path...]
// Writes design/screens/<label>-<route>-{mobile-390x844,desktop-1280x800}.png
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const [label = 'shot', baseUrl = 'http://localhost:3000', ...paths] = process.argv.slice(2)
const routes = paths.length ? paths : ['/']
mkdirSync('design/screens', { recursive: true })
const browser = await chromium.launch()
const targets = [
  ['mobile-390x844', { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } }],
  ['desktop-1280x800', { viewport: { width: 1280, height: 800 } }],
]
for (const route of routes) {
  const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-')
  for (const [name, opts] of targets) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    await page.goto(new URL(route, baseUrl).toString(), { waitUntil: 'networkidle' })
    const file = `design/screens/${label}-${slug}-${name}.png`
    await page.screenshot({ path: file, fullPage: true })
    console.log(file)
    await ctx.close()
  }
}
await browser.close()
