// ---------------------------------------------------------------------------
// Legacy backend URL env var check (Spec 02 — unified-api-auth-refactor).
//
// This codebase used to read THREE different backend URL env var names:
//   BACKEND_URL, BACKEND_SERVICE_URL, PYTHON_BACKEND_URL
// — each with a hardcoded `|| 'http://localhost:8000'` fallback. That
// fragmentation caused a real production outage on 2026-04-07 when the backend
// port changed and only one of the three vars was updated.
//
// As of the unified-api-auth-refactor PR, only `BACKEND_URL` is read.
// `BACKEND_SERVICE_URL` and `PYTHON_BACKEND_URL` are NO-OPS but if they remain
// defined in a stale `.env.local`, this warning fires once at server start so
// operators notice and clean up.
//
// IMPORTANT: this list MUST stay in sync with `LEGACY_ENV_VAR_NAMES` in
// `src/lib/config/backend.ts`. If you change one, change both.
// `next.config.js` is CommonJS and cannot import the TypeScript module
// directly, which is why this check is inlined rather than shared.
// ---------------------------------------------------------------------------
const LEGACY_BACKEND_URL_ENV_VARS = ['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']
const _foundLegacy = LEGACY_BACKEND_URL_ENV_VARS.filter(
  (name) => process.env[name] !== undefined
)
if (_foundLegacy.length > 0) {
  console.warn(
    `[backend-config] Legacy env vars detected and IGNORED: ${_foundLegacy.join(', ')}. ` +
      `Only BACKEND_URL is read. Remove these from your .env to silence this warning.`
  )
}

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
