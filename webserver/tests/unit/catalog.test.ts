import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS as FRONTEND_PERMISSIONS,
  PERMISSION_GROUPS as FRONTEND_GROUPS,
  PERMISSION_GROUP_KEYS,
  groupedPermissions,
  permissionLabel,
} from '@/lib/permissionsCatalog'
import {
  ALL_PERMISSIONS as SERVER_PERMISSIONS,
  PERMISSION_GROUPS,
  SYSTEM_ROLE_PERMISSIONS,
  isKnownPermission,
} from '@/server/auth/permissions'
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isEmailShaped,
  isUsernameShaped,
  passwordLengthIssue,
} from '@/lib/validators'
import { PASSWORD_MAX_BYTES as SERVER_PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH as SERVER_PASSWORD_MIN } from '@/server/auth/password'
import { emailSchema, usernameSchema } from '@/server/validation/schemas'
import { LOCALES, t } from '@/lib/i18n'

/**
 * Parity tests for the two "mirror" modules.
 *
 * A permission or a threshold that exists on one side only is invisible until it
 * bites: a checkbox that does nothing, or a form that accepts what the server
 * rejects. These assertions turn both into a red test instead.
 */

describe('permission catalogue parity', () => {
  it('lists exactly the permissions the server knows', () => {
    expect([...FRONTEND_PERMISSIONS].sort()).toEqual([...SERVER_PERMISSIONS].sort())
  })

  it('groups them the same way', () => {
    for (const group of PERMISSION_GROUP_KEYS) {
      expect(FRONTEND_GROUPS[group], `group ${group}`).toEqual([...PERMISSION_GROUPS[group]])
    }
  })

  it('labels every permission and group in both locales', () => {
    for (const locale of LOCALES) {
      for (const permission of FRONTEND_PERMISSIONS) {
        const label = permissionLabel(permission, locale)
        expect(label, `${locale} label for ${permission}`).not.toBe(permission)
        expect(label.length).toBeGreaterThan(0)
      }
      for (const group of PERMISSION_GROUP_KEYS) {
        const key = `permissions.group.${group}`
        expect(t(key, locale), `${locale} label for ${key}`).not.toBe(key)
      }
    }
  })

  it('renders unknown permissions under an extra group instead of dropping them', () => {
    const groups = groupedPermissions('zh-CN', ['future.thing'])
    const other = groups.find((group) => group.key === 'other')
    expect(other?.permissions.map((row) => row.key)).toContain('future.thing')
  })

  it('grants only permissions that exist', () => {
    for (const permissions of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(isKnownPermission(permission), `${permission} is unknown`).toBe(true)
      }
    }
  })
})

describe('client validator parity with the server', () => {
  it('uses the same password thresholds', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SERVER_PASSWORD_MIN)
    expect(PASSWORD_MAX_BYTES).toBe(SERVER_PASSWORD_MAX_BYTES)
  })

  it('uses the same username bounds as the schema', () => {
    const shortEnough = 'a'.repeat(USERNAME_MIN_LENGTH)
    const tooLong = 'a'.repeat(USERNAME_MAX_LENGTH + 1)
    expect(usernameSchema.safeParse(shortEnough).success).toBe(isUsernameShaped(shortEnough))
    expect(usernameSchema.safeParse(tooLong).success).toBe(isUsernameShaped(tooLong))
    expect(usernameSchema.safeParse('ada.lovelace-1').success).toBe(
      isUsernameShaped('ada.lovelace-1'),
    )
  })

  it('uses the same email verdict as the schema for ordinary input', () => {
    const cases = ['ada@example.com', 'ada@localhost', 'a'.repeat(EMAIL_MAX_LENGTH) + '@x.io']
    for (const value of cases) {
      const serverVerdict = emailSchema.safeParse(value).success
      // The client check is intentionally looser about exotic addresses, so the
      // assertion runs one way: it must never accept what the schema refuses
      // apart from a missing TLD, which no real mailbox has.
      if (isEmailShaped(value)) expect(serverVerdict || !value.includes('.')).toBe(true)
    }
  })

  it('reports password length issues at the same boundary', () => {
    expect(passwordLengthIssue('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('too_short')
    expect(passwordLengthIssue('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
    expect(passwordLengthIssue('好'.repeat(PASSWORD_MAX_BYTES))).toBe('too_long')
  })
})
