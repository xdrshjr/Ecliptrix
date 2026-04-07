/**
 * Vitest configuration for Ecliptrix integration tests.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md §2.4
 *
 * Differences from `vitest.config.ts`:
 *  - Test root is `tests/integration/**` (not `src/**`)
 *  - 90s test timeout to accommodate full-stack boot (~15-30s)
 *  - Node environment (no jsdom — these tests are pure Node fetching against
 *    real servers; no DOM is touched)
 *  - No setup file — integration tests boot real services and don't need the
 *    in-memory localStorage shim
 *  - Sequential execution: a single Vitest worker so port allocation is
 *    deterministic and stack boot/teardown don't cross-talk
 *
 * Run via `npm run test:integration` (defined in package.json).
 */

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // Sequential — never run two integration files in parallel; they may both
    // try to spawn the backend on the same OS resource.
    pool: 'forks',
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
})
