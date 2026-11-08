/**
 * Test environment defaults.
 *
 * Vitest loads this before any module: the config module reads `process.env` once
 * per process, so the required values must exist before the first import of
 * `@/server/config`. Individual cases override them through `createHarness()`.
 */
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'
env.DATABASE_PATH = ':memory:'
env.PUBLIC_BASE_URL = 'http://127.0.0.1:8787'
env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-0123456789'
env.ROOT_ADMIN_EMAIL = 'owner@example.com'
env.ROOT_ADMIN_PASSWORD = 'owner-password-123'
env.ROOT_ADMIN_USERNAME = 'owner'
env.LOG_LEVEL = 'error'
env.AUTO_MIGRATE = 'true'
env.TRUST_PROXY = 'true'
env.TZ = 'UTC'

// Silence structured logging: an assertion failure must be the only output.
const originalLog = console.log
const originalWarn = console.warn
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('{"ts"')) return
  originalLog(...args)
}
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('{"ts"')) return
  originalWarn(...args)
}
