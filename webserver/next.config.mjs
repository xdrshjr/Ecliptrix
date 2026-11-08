/**
 * webserver is deployed on its own (Docker / systemd), so the build must be
 * self-contained: `output: 'standalone'` emits a server bundle that needs no
 * `node_modules` install inside the runtime image.
 *
 * `better-sqlite3` is a native module. It must stay external (never bundled)
 * and must only ever be imported from `src/server/**` — the Edge middleware
 * cannot load it, see spec §2.2 rule 4.
 *
 * SQL migrations are read from disk at boot, so they have to be traced into
 * the standalone output as well (spec R13).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'nodemailer'],
  // The repository root has its own lockfile; without this Next guesses the trace
  // root and the standalone bundle silently misses files.
  outputFileTracingRoot: import.meta.dirname,
  outputFileTracingIncludes: {
    '/**': ['./src/server/db/migrations/**'],
  },
  eslint: {
    // `npm run lint` is the gate; a second lint pass inside `next build`
    // duplicates it and makes CI failures harder to attribute.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Tests are type-checked by `npm run type-check` against the same tsconfig;
    // running it again inside the build only slows the deploy down.
    ignoreBuildErrors: false,
  },
}

export default nextConfig
