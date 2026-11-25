import { getDb } from '@/server/db/client'
import * as settingsRepo from '@/server/db/repositories/settingsRepo'
import * as releaseService from '@/server/services/releaseService'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { DEFAULT_MAX_ACTIVE_SESSIONS, ERROR_CODE } from '@/server/auth/constants'
import { log } from '@/server/http/requestContext'
import { isMailEnabled } from '@/server/mail/mailer'

/**
 * Application settings.
 *
 * Two layers: compile-time defaults from the environment (spec §2.3) and the
 * `app_settings` table. The table wins, so an administrator can flip a switch
 * from the console without a redeploy, and `env` only seeds the first boot.
 *
 * The whitelist below is the contract: an unknown key is a 422, not a silent
 * write, because a typo in a setting name would otherwise be invisible.
 */

export type SettingKey =
  | 'registration.enabled'
  | 'invite.required'
  | 'security.loginMaxAttempts'
  | 'security.loginLockMinutes'
  | 'security.maxActiveSessions'
  | 'session.webTtlHours'
  | 'session.desktopRefreshDays'
  | 'client.minVersion'
  | 'app.maintenanceMessage'
  | 'branding.appName'
  | 'branding.supportEmail'
  | 'mail.verificationRequired'
  | 'mail.verificationTtlHours'
  | 'mail.emailChangeTtlHours'
  | 'mail.notifyNewDevice'
  | 'mail.notifyPasswordChange'
  | 'account.deletionGraceHours'
  | 'account.exportCooldownMinutes'
  | 'audit.retentionDays'

interface SettingSpec {
  type: 'boolean' | 'int' | 'string'
  min?: number
  max?: number
  maxLength?: number
  /** Value written on first boot; `undefined` means "derive from config". */
  default: (env: ReturnType<typeof getConfig>) => unknown
}

const SPECS: Record<SettingKey, SettingSpec> = {
  'registration.enabled': { type: 'boolean', default: (env) => env.registrationEnabled },
  'invite.required': { type: 'boolean', default: (env) => env.inviteRequired },
  'security.loginMaxAttempts': {
    type: 'int',
    min: 3,
    max: 20,
    default: (env) => env.loginMaxAttempts,
  },
  'security.loginLockMinutes': {
    type: 'int',
    min: 1,
    max: 1440,
    default: (env) => env.loginLockMinutes,
  },
  /**
   * Replaces the hard-coded per-user session cap. Lowering it does not kick
   * anybody: the LRU trim in `sessionService.createSession` converges on the
   * next login, and the session it pushes out is recorded as `session_limit`.
   */
  'security.maxActiveSessions': {
    type: 'int',
    min: 1,
    max: 50,
    default: () => DEFAULT_MAX_ACTIVE_SESSIONS,
  },
  'session.webTtlHours': { type: 'int', min: 1, max: 168, default: (env) => env.accessTokenTtlHours },
  'session.desktopRefreshDays': {
    type: 'int',
    min: 7,
    max: 365,
    default: (env) => env.desktopRefreshTokenTtlDays,
  },
  'branding.appName': { type: 'string', maxLength: 40, default: () => 'Ecliptrix' },
  'branding.supportEmail': { type: 'string', maxLength: 120, default: () => '' },
  /**
   * Minimum desktop build. Empty string means "no gate"; a non-empty value is
   * compared semver-style against the client's `clientVersion` at login/register.
   * Format is validated as a side effect of the comparison, not guessed here.
   */
  'client.minVersion': { type: 'string', maxLength: 20, default: () => '' },
  /**
   * Non-empty puts the account server into maintenance mode: login and register
   * answer 503 `service_unavailable` with `details.reason='maintenance'`, while
   * heartbeat, refresh and logout keep working — an already signed-in user must
   * not be locked out of the app by an announcement.
   */
  'app.maintenanceMessage': { type: 'string', maxLength: 200, default: () => '' },
  /**
   * Mail and account-lifecycle policy (migration 0005).
   *
   * `mail.verificationRequired` is clamped to `false` whenever SMTP is not
   * configured: switching it on without a working mail channel would answer 403
   * `email_not_verified` to every desktop login with no way for the user to
   * verify, i.e. it would lock the whole fleet out of the app — including the
   * administrator who flipped the switch.
   */
  'mail.verificationRequired': { type: 'boolean', default: () => false },
  'mail.verificationTtlHours': { type: 'int', min: 1, max: 168, default: () => 48 },
  'mail.emailChangeTtlHours': { type: 'int', min: 1, max: 72, default: () => 24 },
  'mail.notifyNewDevice': { type: 'boolean', default: () => true },
  'mail.notifyPasswordChange': { type: 'boolean', default: () => true },
  'account.deletionGraceHours': { type: 'int', min: 1, max: 720, default: () => 72 },
  'account.exportCooldownMinutes': { type: 'int', min: 1, max: 1440, default: () => 60 },
  'audit.retentionDays': { type: 'int', min: 30, max: 3650, default: () => 180 },
}

export const SETTING_KEYS = Object.keys(SPECS) as SettingKey[]

function specFor(key: string): SettingSpec | undefined {
  return SPECS[key as SettingKey]
}

/** The value used when the row is missing (env-derived, not hard-coded). */
export function defaultFor(key: SettingKey): unknown {
  return SPECS[key].default(getConfig())
}

/** Seed defaults without overwriting an administrator's choice. */
export function seedDefaults(): void {
  const values: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) values[key] = defaultFor(key)
  settingsRepo.setDefaults(getDb(), values, null, Date.now())
}

export function all(): Record<SettingKey, unknown> {
  const stored = settingsRepo.getAll(getDb())
  const out = {} as Record<SettingKey, unknown>
  for (const key of SETTING_KEYS) {
    out[key] = key in stored ? stored[key] : defaultFor(key)
  }
  // Read-side clamp (the write side refuses the same combination in `patch`).
  // A database restored from a deployment that HAD SMTP, or an environment where
  // SMTP was removed, would otherwise still answer 403 to every desktop login.
  if (!isMailEnabled() && out['mail.verificationRequired'] === true) {
    out['mail.verificationRequired'] = false
  }
  return out
}

export function getBoolean(key: SettingKey): boolean {
  const value = all()[key]
  return typeof value === 'boolean' ? value : Boolean(defaultFor(key))
}

export function getNumber(key: SettingKey): number {
  const value = all()[key]
  return typeof value === 'number' ? value : Number(defaultFor(key))
}

export function getString(key: SettingKey): string {
  const value = all()[key]
  return typeof value === 'string' ? value : String(defaultFor(key))
}

/** First `details.fields[].message` of an AppError, or `null` for anything else. */
function appErrorFieldMessage(error: unknown): string | null {
  if (!(error instanceof AppError)) return null
  const fields = error.details?.fields
  if (!Array.isArray(fields)) return error.message
  const first = fields[0] as { message?: unknown } | undefined
  return typeof first?.message === 'string' ? first.message : error.message
}

export interface SettingsPatchResult {
  changed: Record<string, { before: unknown; after: unknown }>
}

/**
 * Apply a partial patch.
 *
 * @throws {AppError} `validation_failed` listing every rejected key, so the
 *         console can highlight all of them at once rather than one per submit.
 */
export function patch(
  input: Record<string, unknown>,
  actorUserId: string,
  now = Date.now(),
): SettingsPatchResult {
  const current = all()
  const failures: { path: string; message: string }[] = []
  const accepted: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(input)) {
    const spec = specFor(key)
    if (!spec) {
      failures.push({ path: key, message: '未知的设置项' })
      continue
    }
    if (spec.type === 'boolean') {
      if (typeof rawValue !== 'boolean') {
        failures.push({ path: key, message: '必须是布尔值' })
        continue
      }
      // Symmetric with the read-side clamp: refuse to arm a verification gate
      // that cannot be satisfied.
      if (key === 'mail.verificationRequired' && rawValue && !isMailEnabled()) {
        failures.push({
          path: key,
          message: '未配置邮件服务（SMTP）时不能开启邮箱验证，否则所有桌面端用户都无法登录',
        })
        continue
      }
    } else if (spec.type === 'int') {
      if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
        failures.push({ path: key, message: '必须是整数' })
        continue
      }
      if ((spec.min !== undefined && rawValue < spec.min) || (spec.max !== undefined && rawValue > spec.max)) {
        failures.push({ path: key, message: `必须在 ${spec.min} 到 ${spec.max} 之间` })
        continue
      }
    } else {
      if (typeof rawValue !== 'string') {
        failures.push({ path: key, message: '必须是字符串' })
        continue
      }
      if (spec.maxLength !== undefined && rawValue.length > spec.maxLength) {
        failures.push({ path: key, message: `最多 ${spec.maxLength} 个字符` })
        continue
      }
      // The version gate is the one setting that can lock every desktop user out
      // of the product, so it is checked against an actual fact (the current
      // release on the stable channel) instead of a shape. The console warning is
      // only a reflection of this rule; the server is the enforcement (analysis
      // C10).
      //
      // Only a CHANGED value is checked. The console posts the whole settings
      // object on every save, so validating the value that is already stored would
      // make an unrelated edit ("change the login attempt limit") fail on a
      // deployment that armed the gate before any release existed — a lockout
      // invented by the fix for a lockout. There is no new risk: an unchanged
      // value is exactly the state the deployment is already in.
      if (key === 'client.minVersion' && rawValue.trim() !== current[key]) {
        try {
          releaseService.assertMinVersionAllowed(rawValue)
        } catch (error) {
          const fieldMessage = appErrorFieldMessage(error)
          if (fieldMessage === null) throw error
          failures.push({ path: key, message: fieldMessage })
          continue
        }
      }
    }
    accepted[key] = rawValue
  }

  if (failures.length > 0) {
    throw new AppError(ERROR_CODE.validationFailed, '部分设置值不合法', {
      details: { fields: failures },
    })
  }
  if (Object.keys(accepted).length === 0) {
    return { changed: {} }
  }

  settingsRepo.setMany(getDb(), accepted, actorUserId, now)

  const changed: Record<string, { before: unknown; after: unknown }> = {}
  for (const [key, after] of Object.entries(accepted)) {
    const before = current[key as SettingKey]
    if (before !== after) changed[key] = { before, after }
  }
  if (Object.keys(changed).length > 0) {
    log('info', 'settings updated', { changed: Object.keys(changed), actorUserId })
  }
  return { changed }
}

/** Public snapshot for `GET /api/v1/meta` — no internal keys leak here. */
export function publicMeta(): {
  registrationEnabled: boolean
  inviteRequired: boolean
  smtpEnabled: boolean
  passwordPolicy: { minLength: number; maxBytes: number }
  appName: string
  supportEmail: string
  version: string
  /** Empty string = no version gate. The desktop compares it before login. */
  minClientVersion: string
  /** Empty string = not in maintenance mode. */
  maintenanceMessage: string
  /**
   * Newest *client* build that is actually published, or `null` when nothing is.
   *
   * Deliberately a different field from `version` below, which is this npm
   * package's own version: rendering that one as "the client version" would show
   * 0.1.0 next to a 1.0.2 installer (analysis R-3).
   */
  latestClientVersion: string | null
  /** Absolute address of the download page, built from `PUBLIC_BASE_URL`. */
  downloadUrl: string
  maxActiveSessions: number
  /** True when this deployment would refuse an unverified desktop login. */
  emailVerificationRequired: boolean
} {
  const config = getConfig()
  return {
    registrationEnabled: getBoolean('registration.enabled'),
    inviteRequired: getBoolean('invite.required'),
    smtpEnabled: config.smtp.enabled,
    passwordPolicy: { minLength: 10, maxBytes: 128 },
    appName: getString('branding.appName'),
    supportEmail: getString('branding.supportEmail'),
    version: process.env.npm_package_version ?? '0.1.0',
    // Both gates live in `app_settings`, so an operator can flip them without a
    // redeploy — that is the whole point of having a console.
    //
    // `minClientVersion` is the EFFECTIVE gate, not the stored row: a stored value
    // above the served build is a lockout with no download behind it, so the read
    // side clamps it (analysis A1-1). The desktop renderer reads this field from
    // `/meta` and refuses to render the login form before any API call happens
    // (`LoginScreen.isClientOutdated`), so publishing a different number here than
    // the login gate enforces would leave the API open and the UI still locked.
    minClientVersion: releaseService.effectiveMinVersion(getString('client.minVersion')),
    latestClientVersion: releaseService.latestPublishedVersion(),
    downloadUrl: releaseService.downloadPageUrl(),
    maintenanceMessage: getString('app.maintenanceMessage'),
    maxActiveSessions: getNumber('security.maxActiveSessions'),
    // Already clamped by `all()`: false whenever SMTP is not configured.
    emailVerificationRequired: getBoolean('mail.verificationRequired'),
  }
}
