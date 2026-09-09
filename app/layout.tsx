import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans } from 'next/font/google'
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
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
