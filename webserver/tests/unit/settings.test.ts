import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import * as settingsService from '@/server/services/settingsService'
import { usersRepo } from '../setup/repos'

/**
 * The three settings that gate the desktop client.
 *
 * They are pinned here rather than only in the integration suite because a wrong
 * default or a missing range is invisible until somebody flips it in production:
 * `client.minVersion` above the released build locks every older client out, and
 * a `security.maxActiveSessions` of 0 would revoke each session as it is created.
 */

let harness: TestHarness
let actorId: string

beforeEach(async () => {
  harness = await createHarness()
  actorId = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')?.id ?? ''
})

afterEach(() => {
  harness.teardown()
})

function patch(values: Record<string, unknown>) {
  return settingsService.patch(values, actorId)
}

describe('desktop gate settings', () => {
  it('defaults to no version gate, no announcement and ten sessions', () => {
    expect(settingsService.getString('client.minVersion')).toBe('')
    expect(settingsService.getString('app.maintenanceMessage')).toBe('')
    expect(settingsService.getNumber('security.maxActiveSessions')).toBe(10)
  })

  it('exposes the three gates through publicMeta()', () => {
    const meta = settingsService.publicMeta()
    expect(meta.minClientVersion).toBe('')
    expect(meta.maintenanceMessage).toBe('')
    expect(meta.maxActiveSessions).toBe(10)
  })

  it('accepts the inclusive bounds of security.maxActiveSessions', () => {
    expect(() => patch({ 'security.maxActiveSessions': 1 })).not.toThrow()
    expect(settingsService.getNumber('security.maxActiveSessions')).toBe(1)
    expect(() => patch({ 'security.maxActiveSessions': 50 })).not.toThrow()
    expect(settingsService.getNumber('security.maxActiveSessions')).toBe(50)
  })

  it('rejects an out-of-range or non-integer session cap', () => {
    for (const value of [0, 51, 2.5]) {
      expect(() => patch({ 'security.maxActiveSessions': value })).toThrowError(
        expect.objectContaining({ code: 'validation_failed' }),
      )
    }
  })

  it('rejects a minimum version longer than 20 characters', () => {
    expect(() => patch({ 'client.minVersion': '1.0.0-'.repeat(4) })).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
    // 20 characters is still accepted: the ceiling is the length, not the shape.
    expect(() => patch({ 'client.minVersion': '1.0.0-alpha.20261008' })).not.toThrow()
  })

  it('rejects a maintenance announcement longer than 200 characters', () => {
    expect(() => patch({ 'app.maintenanceMessage': 'x'.repeat(201) })).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
    expect(() => patch({ 'app.maintenanceMessage': '今晚 23:00 数据库维护' })).not.toThrow()
    expect(settingsService.getString('app.maintenanceMessage')).toBe('今晚 23:00 数据库维护')
  })

  it('answers an unknown key with 422, never a silent write', () => {
    expect(() => patch({ 'client.maxVersion': '9.9.9' })).toThrowError(
      expect.objectContaining({
        code: 'validation_failed',
        details: { fields: [{ path: 'client.maxVersion', message: '未知的设置项' }] },
      }),
    )
  })
})

describe('mail and account policy settings', () => {
  it('has defaults and bounds for the eight new keys', () => {
    expect(settingsService.getBoolean('mail.verificationRequired')).toBe(false)
    expect(settingsService.getNumber('mail.verificationTtlHours')).toBe(48)
    expect(settingsService.getNumber('mail.emailChangeTtlHours')).toBe(24)
    expect(settingsService.getBoolean('mail.notifyNewDevice')).toBe(true)
    expect(settingsService.getBoolean('mail.notifyPasswordChange')).toBe(true)
    expect(settingsService.getNumber('account.deletionGraceHours')).toBe(72)
    expect(settingsService.getNumber('account.exportCooldownMinutes')).toBe(60)
    expect(settingsService.getNumber('audit.retentionDays')).toBe(180)
    // All eight are whitelisted, so a PATCH of any of them is not an unknown-key 422.
    for (const key of [
      'mail.verificationRequired',
      'mail.verificationTtlHours',
      'mail.emailChangeTtlHours',
      'mail.notifyNewDevice',
      'mail.notifyPasswordChange',
      'account.deletionGraceHours',
      'account.exportCooldownMinutes',
      'audit.retentionDays',
    ]) {
      expect(settingsService.SETTING_KEYS).toContain(key)
    }
  })

  it('rejects out-of-range values for the new numeric keys', () => {
    const cases: [string, number][] = [
      ['mail.verificationTtlHours', 0],
      ['mail.verificationTtlHours', 169],
      ['mail.emailChangeTtlHours', 73],
      ['account.deletionGraceHours', 0],
      ['account.exportCooldownMinutes', 1441],
      ['audit.retentionDays', 29],
    ]
    for (const [key, value] of cases) {
      expect(() => patch({ [key]: value })).toThrowError(
        expect.objectContaining({ code: 'validation_failed' }),
      )
    }
  })

  it('refuses to arm the verification gate while smtp is off', () => {
    expect(() => patch({ 'mail.verificationRequired': true })).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    )
    // … and the read side reports false regardless of what is stored.
    expect(settingsService.publicMeta().emailVerificationRequired).toBe(false)
  })

  it('accepts the new keys that do not depend on smtp', () => {
    expect(() => patch({ 'account.deletionGraceHours': 24 })).not.toThrow()
    expect(settingsService.getNumber('account.deletionGraceHours')).toBe(24)
    expect(() => patch({ 'mail.notifyNewDevice': false })).not.toThrow()
    expect(settingsService.getBoolean('mail.notifyNewDevice')).toBe(false)
  })
})
