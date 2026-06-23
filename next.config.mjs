/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // xlsx is only used inside server-side route handlers
    serverComponentsExternalPackages: ['xlsx'],
  },
};

export default nextConfig;
