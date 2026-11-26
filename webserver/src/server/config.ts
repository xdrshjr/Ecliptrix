import { dirname, join } from 'node:path'
import { z } from 'zod'

/**
 * Runtime configuration for the account server.
 *
 * Contract (spec §2.3):
 *  - Every value is parsed once, at boot, and validated with zod.
 *  - A missing required value is fatal. A security service must never boot in
 *    a half-configured "degraded" mode, so `loadConfig` throws and the boot
 *    wrapper prints every problem before exiting non-zero.
 *  - Values read here are the *initial* defaults; anything an administrator can
 *    change at runtime lives in `app_settings` and wins over these defaults
 *    (see `settingsService`).
 */

const booleanish = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  })

const intInRange = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return undefined
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be an integer between ${min} and ${max}`,
        })
        return z.NEVER
      }
      return parsed
    })

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))

/**
 * Where uploaded installers live.
 *
 * An explicit `RELEASES_DIR` always wins. Otherwise the directory sits next to
 * the database file: `DATABASE_PATH` is the one path a deployment must already
 * have correct, and `deploy/webserver.service` grants writes to its directory
 * only — a default somewhere else would fail with EACCES at upload time, long
 * after "the service started fine" was reported.
 */
function resolveReleasesDir(explicit: string | undefined, databasePath: string): string {
  if (explicit) return explicit
  if (databasePath === ':memory:') return join(process.cwd(), 'data', 'releases')
  return join(dirname(databasePath), 'releases')
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intInRange(1, 65535),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().min(1, 'DATABASE_PATH is required (e.g. ./data/webserver.db)'),
  RELEASES_DIR: optionalString,
  PUBLIC_BASE_URL: z
    .string()
    .min(1, 'PUBLIC_BASE_URL is required (e.g. https://id.example.com)')
    .refine((value) => /^https?:\/\/[^/]+/i.test(value), 'must be an absolute http(s) URL')
    .refine((value) => !value.endsWith('/'), 'must not end with a slash'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters of entropy'),
  ROOT_ADMIN_EMAIL: z.string().email('ROOT_ADMIN_EMAIL must be a valid email address'),
  ROOT_ADMIN_PASSWORD: z
    .string()
    .min(10, 'ROOT_ADMIN_PASSWORD must be at least 10 characters'),
  ROOT_ADMIN_USERNAME: z.string().default('xdrshjr'),
  RESET_ROOT_ADMIN_PASSWORD: booleanish,
  REGISTRATION_ENABLED: booleanish,
  INVITE_REQUIRED: booleanish,
  ACCESS_TOKEN_TTL_HOURS: intInRange(1, 168),
  REFRESH_TOKEN_TTL_DAYS: intInRange(1, 365),
  DESKTOP_REFRESH_TOKEN_TTL_DAYS: intInRange(1, 365),
  LOGIN_MAX_ATTEMPTS: intInRange(3, 20),
  LOGIN_LOCK_MINUTES: intInRange(1, 1440),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  SMTP_HOST: optionalString,
  SMTP_PORT: intInRange(1, 65535),
  SMTP_SECURE: booleanish,
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  TRUST_PROXY: booleanish,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  AUTO_MIGRATE: optionalString,
  MAIL_SEND_TIMEOUT_MS: intInRange(500, 20000),
  ECLIPTRIX_E2E: booleanish,
})

export interface ServerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly isProduction: boolean
  readonly port: number
  readonly host: string
  readonly databasePath: string
  /**
   * Directory holding uploaded desktop installers — deliberately NOT under
   * `public/`: a standalone `next start` never serves files added to `public/`
   * after the build, so an installer copied there would be uploaded successfully
   * and then 404 for every user (analysis §6.4 trap 1).
   *
   * Defaults to `releases/` next to the database file, which keeps it inside the
   * data directory that `deploy/webserver.service` already allows writes to.
   */
  readonly releasesDir: string
  readonly publicBaseUrl: string
  readonly sessionSecret: string
  readonly rootAdminEmail: string
  readonly rootAdminPassword: string
  readonly rootAdminUsername: string
  readonly resetRootAdminPassword: boolean
  readonly registrationEnabled: boolean
  readonly inviteRequired: boolean
  readonly accessTokenTtlHours: number
  readonly refreshTokenTtlDays: number
  readonly desktopRefreshTokenTtlDays: number
  readonly loginMaxAttempts: number
  readonly loginLockMinutes: number
  readonly corsAllowedOrigins: readonly string[]
  readonly smtp: {
    readonly host?: string
    readonly port: number
    readonly secure: boolean
    readonly user?: string
    readonly password?: string
    readonly from: string
    readonly enabled: boolean
  }
  readonly trustProxy: boolean
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly autoMigrate: boolean
  /**
   * Upper bound on ONE SMTP attempt, applied to all three nodemailer timeouts
   * (`connectionTimeout` / `greetingTimeout` / `socketTimeout`).
   *
   * Without it the only limit is nodemailer's default socketTimeout of one hour,
   * which turns "the SMTP host is unreachable" into a hung register request.
   */
  readonly mailSendTimeoutMs: number
  /** Playwright banner: never true in production, see `loadConfig`. */
  readonly e2eMode: boolean
}

export class ConfigError extends Error {
  public readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/**
 * Parse configuration out of an environment record.
 *
 * The parameter is a plain `Record<string, string | undefined>` rather than
 * `NodeJS.ProcessEnv`: Next augments that type with a `NODE_ENV` union, which makes
 * it needlessly awkward to pass a literal environment from tests.
 *
 * @throws {ConfigError} when a required value is missing or malformed.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }
  const value = parsed.data
  const nodeEnv = value.NODE_ENV
  const autoMigrateRaw = value.AUTO_MIGRATE?.toLowerCase()
  const smtpHost = value.SMTP_HOST

  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: value.PORT ?? 8787,
    host: value.HOST,
    databasePath: value.DATABASE_PATH,
    releasesDir: resolveReleasesDir(value.RELEASES_DIR, value.DATABASE_PATH),
    publicBaseUrl: value.PUBLIC_BASE_URL,
    sessionSecret: value.SESSION_SECRET,
    rootAdminEmail: value.ROOT_ADMIN_EMAIL.trim().toLowerCase(),
    rootAdminPassword: value.ROOT_ADMIN_PASSWORD,
    rootAdminUsername: value.ROOT_ADMIN_USERNAME.trim() || 'xdrshjr',
    resetRootAdminPassword: value.RESET_ROOT_ADMIN_PASSWORD === true,
    registrationEnabled: value.REGISTRATION_ENABLED ?? true,
    inviteRequired: value.INVITE_REQUIRED === true,
    accessTokenTtlHours: value.ACCESS_TOKEN_TTL_HOURS ?? 12,
    refreshTokenTtlDays: value.REFRESH_TOKEN_TTL_DAYS ?? 30,
    desktopRefreshTokenTtlDays: value.DESKTOP_REFRESH_TOKEN_TTL_DAYS ?? 90,
    loginMaxAttempts: value.LOGIN_MAX_ATTEMPTS ?? 5,
    loginLockMinutes: value.LOGIN_LOCK_MINUTES ?? 15,
    corsAllowedOrigins: (value.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    smtp: {
      host: smtpHost,
      port: value.SMTP_PORT ?? 587,
      secure: value.SMTP_SECURE === true,
      user: value.SMTP_USER,
      password: value.SMTP_PASSWORD,
      from: value.SMTP_FROM ?? 'Ecliptrix <no-reply@localhost>',
      enabled: Boolean(smtpHost),
    },
    trustProxy: value.TRUST_PROXY ?? true,
    logLevel: value.LOG_LEVEL,
    autoMigrate: autoMigrateRaw === undefined ? nodeEnv !== 'production' : autoMigrateRaw === 'true',
    mailSendTimeoutMs: value.MAIL_SEND_TIMEOUT_MS ?? 5000,
    // A production deployment must never answer to the test flag, however the
    // environment was assembled: E2E mode loosens CSRF-free guards and is only
    // ever legitimate against a throwaway database.
    e2eMode: nodeEnv !== 'production' && (nodeEnv === 'test' || value.ECLIPTRIX_E2E === true),
  })
}

let cached: ServerConfig | undefined

/**
 * Process-wide configuration singleton.
 *
 * @throws {ConfigError} on first access when the environment is invalid.
 */
export function getConfig(): ServerConfig {
  if (!cached) cached = loadConfig()
  return cached
}

/** Replace the singleton — tests only. Pass `undefined` to force a re-read. */
export function setConfigForTests(next: ServerConfig | undefined): void {
  cached = next
}
