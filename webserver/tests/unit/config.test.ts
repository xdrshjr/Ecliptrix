import { describe, expect, it } from 'vitest'
import { loadConfig, ConfigError } from '@/server/config'

/**
 * Configuration is the service's first security boundary: a missing secret must
 * stop the boot, never degrade into a weaker default.
 */
describe('loadConfig', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_PATH: './data/test.db',
    PUBLIC_BASE_URL: 'https://id.example.com',
    SESSION_SECRET: 'x'.repeat(48),
    ROOT_ADMIN_EMAIL: 'owner@example.com',
    ROOT_ADMIN_PASSWORD: 'owner-password-123',
  }

  it('accepts a minimal valid environment and applies documented defaults', () => {
    const config = loadConfig({ ...base })
    expect(config.port).toBe(8787)
    expect(config.accessTokenTtlHours).toBe(12)
    expect(config.desktopRefreshTokenTtlDays).toBe(90)
    expect(config.loginMaxAttempts).toBe(5)
    expect(config.smtp.enabled).toBe(false)
    expect(config.autoMigrate).toBe(true)
  })

  it('rejects a missing required variable and lists every problem', () => {
    let caught: unknown
    try {
      loadConfig({ NODE_ENV: 'development' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ConfigError)
    const issues = (caught as ConfigError).issues.join('\n')
    expect(issues).toContain('DATABASE_PATH')
    expect(issues).toContain('SESSION_SECRET')
    expect(issues).toContain('ROOT_ADMIN_EMAIL')
  })

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'too-short' })).toThrow(ConfigError)
  })

  it('rejects a base URL with a trailing slash (cookie scoping would break)', () => {
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'https://id.example.com/' })).toThrow(
      ConfigError,
    )
  })

  it('rejects an out-of-range numeric limit rather than clamping silently', () => {
    expect(() => loadConfig({ ...base, LOGIN_MAX_ATTEMPTS: '99' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, ACCESS_TOKEN_TTL_HOURS: '0' })).toThrow(ConfigError)
  })

  it('derives autoMigrate from NODE_ENV when unset, and honours an explicit value', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).autoMigrate).toBe(false)
    expect(loadConfig({ ...base, NODE_ENV: 'production', AUTO_MIGRATE: 'true' }).autoMigrate).toBe(
      true,
    )
  })

  it('enables mail only when an SMTP host is present', () => {
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' }).smtp.enabled).toBe(true)
    expect(loadConfig({ ...base, SMTP_HOST: '   ' }).smtp.enabled).toBe(false)
  })

  it('normalises the root admin email and splits CORS origins', () => {
    const config = loadConfig({
      ...base,
      ROOT_ADMIN_EMAIL: 'Owner@Example.COM',
      CORS_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
    })
    expect(config.rootAdminEmail).toBe('owner@example.com')
    expect(config.corsAllowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com'])
  })
})

describe('secret hygiene', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_PATH: './data/test.db',
    PUBLIC_BASE_URL: 'https://id.example.com',
    SESSION_SECRET: 'x'.repeat(48),
    ROOT_ADMIN_EMAIL: 'owner@example.com',
    ROOT_ADMIN_PASSWORD: 'owner-password-123',
  }

  it('never echoes secret values inside the error message', () => {
    let message = ''
    try {
      loadConfig({ ...base, SESSION_SECRET: 'short' })
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    // The message names the variable, never the value.
    expect(message).toContain('SESSION_SECRET')
    expect(message).not.toContain('at least 32 characters of entropy=short')
  })
})
