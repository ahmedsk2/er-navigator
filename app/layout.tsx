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
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f7a8c' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
