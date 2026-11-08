import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Tests run in the `node` environment: everything under `src/server/**` is
 * pure Node (better-sqlite3, node:crypto) and the integration suite owns a
 * real temporary database file per case — the root repository's rule
 * "do not mock high-risk paths" applies here too (CLAUDE.md §7).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/env.ts'],
    // Every integration case creates, migrates and drops its own SQLite file,
    // so cases must not share a worker-scoped database.
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/db/migrations/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
