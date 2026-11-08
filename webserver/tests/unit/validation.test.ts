import { describe, expect, it } from 'vitest'
import { loginSchema, profilePatchSchema, registerSchema, bulkActionSchema } from '@/server/validation/schemas'

describe('loginSchema', () => {
  it('accepts an email identifier and defaults the client to web', () => {
    const parsed = loginSchema.parse({ identifier: 'ada@example.com', password: 'x' })
    expect(parsed.client).toBe('web')
    expect(parsed.device).toEqual({ name: '', platform: '', appVersion: '' })
  })

  it('accepts a desktop login with device metadata', () => {
    const parsed = loginSchema.parse({
      identifier: 'ada',
      password: 'x',
      client: 'desktop',
      device: { name: 'Ada 的 MacBook', platform: 'darwin-arm64', appVersion: '1.0.1' },
    })
    expect(parsed.client).toBe('desktop')
    expect(parsed.device.platform).toBe('darwin-arm64')
  })

  it('rejects an empty identifier', () => {
    expect(loginSchema.safeParse({ identifier: '', password: 'x' }).success).toBe(false)
  })

  it('rejects an unknown client kind', () => {
    expect(
      loginSchema.safeParse({ identifier: 'ada', password: 'x', client: 'mobile' }).success,
    ).toBe(false)
  })
})

describe('registerSchema', () => {
  it('rejects a malformed email', () => {
    const result = registerSchema.safeParse({ email: 'not-an-email', password: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects a username with illegal characters', () => {
    const result = registerSchema.safeParse({
      email: 'ada@example.com',
      password: 'x',
      username: 'ada lovelace',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a username with dots and hyphens', () => {
    const result = registerSchema.safeParse({
      email: 'ada@example.com',
      password: 'x',
      username: 'ada.l-1',
    })
    expect(result.success).toBe(true)
  })
})

describe('profilePatchSchema', () => {
  it('accepts the four self-service fields', () => {
    const result = profilePatchSchema.safeParse({
      displayName: 'Ada',
      avatarUrl: 'https://example.com/a.png',
      locale: 'en-US',
      timezone: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('refuses an administrator-owned field (strict)', () => {
    const result = profilePatchSchema.safeParse({ displayName: 'Ada', status: 'active' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-URL avatar', () => {
    expect(profilePatchSchema.safeParse({ avatarUrl: 'nope' }).success).toBe(false)
  })
})

describe('bulkActionSchema', () => {
  it('requires a roleId when the action is setRole', () => {
    const result = bulkActionSchema.safeParse({
      action: 'setRole',
      ids: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid suspension batch', () => {
    const result = bulkActionSchema.safeParse({
      action: 'suspend',
      ids: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    })
    expect(result.success).toBe(true)
  })

  it('caps a batch at 200 ids', () => {
    const result = bulkActionSchema.safeParse({
      action: 'suspend',
      ids: Array.from({ length: 201 }, () => '3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
    })
    expect(result.success).toBe(false)
  })
})
