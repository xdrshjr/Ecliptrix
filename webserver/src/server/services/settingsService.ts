import { getDb } from '@/server/db/client'
import * as settingsRepo from '@/server/db/repositories/settingsRepo'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import { log } from '@/server/http/requestContext'

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
  | 'session.webTtlHours'
  | 'session.desktopRefreshDays'
  | 'branding.appName'
  | 'branding.supportEmail'

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
  'session.webTtlHours': { type: 'int', min: 1, max: 168, default: (env) => env.accessTokenTtlHours },
  'session.desktopRefreshDays': {
    type: 'int',
    min: 7,
    max: 365,
    default: (env) => env.desktopRefreshTokenTtlDays,
  },
  'branding.appName': { type: 'string', maxLength: 40, default: () => 'Ecliptrix' },
  'branding.supportEmail': { type: 'string', maxLength: 120, default: () => '' },
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
  }
}
