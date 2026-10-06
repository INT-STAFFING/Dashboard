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
  // Handled at the CDN/edge before any lambda is invoked — the app/page.tsx
  // redirect stays as a fallback for environments that ignore this config.
  async redirects() {
    return [{ source: '/', destination: '/dashboard', permanent: false }];
  },
};

export default nextConfig;
