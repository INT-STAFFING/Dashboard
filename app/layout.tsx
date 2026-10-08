import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import './filterbar.css';
import './pwa.css';
import PwaClient from '@/components/PwaClient';

// Self-hosted via next/font: the fonts are downloaded at build time and served
// from our own origin with a preload + font-display:swap, removing the
// render-blocking googleapis/gstatic request chain (and the FOUT flash on
// slow networks). Exposed as CSS variables consumed by globals.css.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  display: 'swap',
  variable: '--font-fraunces',
  // Display face only (h1/eyebrow): not needed for first paint of body text.
  preload: false,
});

export const metadata: Metadata = {
  title: 'Monitor IF/BO · ARIA SISS L2 · Intellera',
  description:
    'Executive dashboard del portafoglio Interventi di Fornitura — contratto ARIA SISS L2 (CIG B313D0710B).',
  applicationName: 'Monitor IF/BO',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Monitor IF/BO',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0E6E63',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <PwaClient />
        {/* Vercel Speed Insights (real-user Web Vitals), loaded only when running on
            Vercel — elsewhere /_vercel/speed-insights/script.js doesn't exist. It
            collects data once Speed Insights is enabled for the project in the
            Vercel dashboard. */}
        {process.env.VERCEL ? (
          <>
            <Script id="vercel-speed-insights-init" strategy="afterInteractive">
              {'window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };'}
            </Script>
            <Script src="/_vercel/speed-insights/script.js" strategy="afterInteractive" />
          </>
        ) : null}
      </body>
    </html>
  );
}
