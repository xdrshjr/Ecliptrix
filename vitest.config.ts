// Vitest configuration for Ecliptrix unit tests.
//
// Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md section 2.1
//
// Notes:
//  - jsdom is required because almost every dormant test under
//    src/lib/api/__tests__/ and src/components touches window and localStorage.
//  - The server-only package throws when imported outside a Next.js Server
//    Component bundle. We alias it to a no-op stub so that
//    src/lib/config/backend.ts and src/lib/api/server/backend-proxy.ts
//    evaluate cleanly under Vitest.
//  - The @ alias mirrors the tsconfig.json paths entry, so test files can use
//    the same import shape as production code.
//  - Integration tests live under tests/integration and run via a separate
//    config (vitest.integration.config.ts). They MUST be excluded here
//    because they boot real services.
//  - src/components/video/utils/__tests__/trimming.test.ts is excluded:
//    it predates this refactor and uses Jest globals without the Vitest
//    import. Including it would block the entire suite. Documented in
//    audit/test-coverage-audit.md as out-of-scope tech debt.

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    env: {
      // Force React to load the development build so `React.act` is exposed
      // for @testing-library/react's renderHook. Vitest 4 on Windows does not
      // reliably propagate NODE_ENV=test on its own.
      NODE_ENV: 'test',
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'node_modules',
      '.next',
      'tests/integration/**',
      'src/components/video/utils/__tests__/trimming.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/lib/api/http-client.ts',
        'src/lib/api/server/backend-proxy.ts',
        'src/lib/config/backend.ts',
      ],
      reportsDirectory: './coverage',
    },
    // Vitest 4 requires server.deps.inline for ESM modules that are tricky
    // to externalize. server-only is also aliased below for safety.
    server: {
      deps: {
        inline: ['server-only'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
})
