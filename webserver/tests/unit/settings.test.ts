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
