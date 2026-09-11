import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans } from 'next/font/google'
import type { CSSProperties } from 'react'
import { InstanceBanner } from '@/src/components/shell/InstanceBanner'
import { buildFingerprint } from '@/src/lib/fingerprint'
import { INSTANCE_BANNER_HEIGHT, instanceLabel } from '@/src/lib/instance'
import './globals.css'

// Self-hosted at build time by next/font: no runtime request to Google, so it works on the
// hospital network and under the font-src 'self' CSP. Tabular figures come from the .num class.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ER Navigator',
  description: 'Tracks ED patients whose stay is running long. Qatif Central Hospital ER Navigators.',
  applicationName: 'ER Navigator',
  robots: { index: false, follow: false },
  // The PWA (Phase 7). These become <link rel="manifest">, <link rel="icon"> and
  // <link rel="apple-touch-icon"> in the head of every page; `app/manifest.ts` is what the first
  // one points at, and proxy.ts keeps all of them reachable signed out so an install can start.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    // iOS has no manifest: these are what make "Add to Home Screen" open without browser chrome.
    capable: true,
    title: 'ER Nav',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f7a8c' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /*
    How tall the banner below is, published to the page (Phase 12 review round, finding 4). Set
    only when a label is set — the same condition that renders the banner — so production's body
    carries no style attribute and everything that reads the variable falls back to `0px` and is
    byte-for-byte the layout it was before. `InstanceBanner` takes its height from this variable
    and `TabBar`'s rail subtracts it, so the two can never disagree about what the banner cost.
  */
  const banner = instanceLabel() ? ({ '--instance-banner': INSTANCE_BANNER_HEIGHT } as CSSProperties) : undefined
  return (
    // data-build: the fingerprint of the build that rendered this page. app/error.tsx compares it
    // with the live one and reloads a screen that stayed open across a deploy (src/lib/build-check.ts).
    <html lang="en" className={plex.variable} data-build={buildFingerprint()}>
      {/* The instance banner is first in the body and in normal flow (Phase 12, D6): on the demo
          copy every page says so, and it prints. It renders nothing at all when INSTANCE_LABEL is
          unset, which is production. */}
      <body className="min-h-dvh antialiased" style={banner}>
        <InstanceBanner />
        {children}
      </body>
    </html>
  )
}
