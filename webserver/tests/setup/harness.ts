import { openDatabase } from '@/server/db/client'
import { setDbForTests } from '@/server/db/client'
import { runMigrations } from '@/server/db/migrate'
import { runSeed } from '@/server/db/seed'
import { getConfig, loadConfig, setConfigForTests, type ServerConfig } from '@/server/config'
import { log } from '@/server/http/requestContext'

/**
 * Test harness: one real SQLite file per case.
 *
 * The root repository's rule "do not mock high-risk paths" applies to schema
 * creation, so this builds the actual database from the actual migration files
 * rather than a stubbed schema.
 */

export interface TestHarness {
  config: ServerConfig
  dbPath: string
  teardown: () => void
}

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-0123456789',
  ROOT_ADMIN_EMAIL: 'owner@example.com',
  ROOT_ADMIN_PASSWORD: 'owner-password-123',
  ROOT_ADMIN_USERNAME: 'owner',
  LOG_LEVEL: 'error',
  AUTO_MIGRATE: 'true',
  TRUST_PROXY: 'true',
}

/** Build a fresh, migrated, seeded in-memory database for one test case. */
export async function createHarness(overrides: Record<string, string> = {}): Promise<TestHarness> {
  const env = { ...TEST_ENV, ...overrides } as NodeJS.ProcessEnv
  const config = loadConfig(env)
  setConfigForTests(config)

  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)
  await runSeed()

  return {
    config,
    dbPath: config.databasePath,
    teardown: () => {
      if (db.open) db.close()
      setDbForTests(undefined)
      setConfigForTests(undefined)
    },
  }
}

/** Current configuration (after `createHarness` has installed it). */
export function currentConfig(): ServerConfig {
  return getConfig()
}

export function silentLog(): void {
  log('debug', 'test harness ready')
}
