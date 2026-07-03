import type { Metadata, Viewport } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import './filterbar.css';

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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
