/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: [],
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  // Prevent webpack from bundling Node.js built-in modules used by
  // @mariozechner/pi-ai (env-api-keys.js dynamically imports node:fs/os/path).
  // These must be resolved at runtime by Node.js, not at bundle time.
  serverExternalPackages: ['@mariozechner/pi-ai', '@mariozechner/pi-agent-core'],
}

module.exports = nextConfig 