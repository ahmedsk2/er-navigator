import type { MetadataRoute } from 'next'

/**
 * The web app manifest (Phase 7, locked plan section 8 item 10). Next serves this at
 * `/manifest.webmanifest`, which `proxy.ts` keeps public: a phone fetches the manifest and the
 * icons before anyone signs in, and a redirect to the login form would break installation.
 *
 * `display: standalone` and `start_url: '/'` mean the installed app opens on the board with no
 * browser chrome — the shift's home screen. Colours are the design tokens: the accent for the
 * theme (the Android status bar and the iOS splash tint) and the page background for the splash
 * itself, so the launch does not flash white.
 *
 * No offline anything. The locked plan forbids offline writes, and a clinical board that shows a
 * stale list without saying so is worse than one that says the network is down, so there is no
 * service worker and no cache here.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ER Navigator',
    short_name: 'ER Nav',
    description: 'Tracks ED patients whose stay is running long. Qatif Central Hospital.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#1f7a8c',
    background_color: '#f5f7f6',
    lang: 'en',
    dir: 'ltr',
    icons: [
      // Each size twice, `any` and `maskable`: the same file serves both because the mark is
      // drawn inside the W3C safe zone (scripts/generate-icons.mjs), and Next's Manifest type
      // takes one purpose per entry rather than the "any maskable" pair in one string.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
