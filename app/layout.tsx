import type { Metadata } from 'next';
import './globals.css';
import './filterbar.css';

export const metadata: Metadata = {
  title: 'Monitor IF/BO · ARIA SISS L2 · Intellera',
  description:
    'Executive dashboard del portafoglio Interventi di Fornitura — contratto ARIA SISS L2 (CIG B313D0710B).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
