/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Loads instrumentation.ts (production config checks at server start).
    instrumentationHook: true,
    // xlsx is only used inside server-side route handlers
    serverComponentsExternalPackages: ['xlsx'],
  },
  // Stamped into /sw.js: its bytes change on every deploy, which is what makes
  // browsers detect a new version and trigger the "Aggiornamento disponibile" toast.
  env: {
    SW_VERSION:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.SW_VERSION || 'dev',
  },
  async headers() {
    return [
      {
        // The worker must always be revalidated so updates are noticed.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
        ],
      },
      // /_next/static/* is already served immutable by Next.js (hashed file names).
    ];
  },
  // Handled at the CDN/edge before any lambda is invoked — the app/page.tsx
  // redirect stays as a fallback for environments that ignore this config.
  async redirects() {
    return [{ source: '/', destination: '/dashboard', permanent: false }];
  },
};

export default nextConfig;
