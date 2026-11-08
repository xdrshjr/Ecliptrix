import { describe, expect, it } from 'vitest'
import {
  loginSchema,
  profilePatchSchema,
  registerSchema,
  bulkActionSchema,
  emailVerifySchema,
  emailChangeSchema,
  adminSessionsRevokeSchema,
  adminDeletionConfirmSchema,
  createInviteSchema,
} from '@/server/validation/schemas'
import { ERROR_CODE, type ErrorCode } from '@/server/auth/constants'
import { ERROR_STATUS } from '@/server/http/errors'

describe('loginSchema', () => {
  it('accepts an email identifier and defaults the client to web', () => {
    const parsed = loginSchema.parse({ identifier: 'ada@example.com', password: 'x' })
    expect(parsed.client).toBe('web')
    expect(parsed.device).toEqual({ name: '', platform: '', appVersion: '', deviceKey: '' })
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

describe('account lifecycle schemas', () => {
  it('accepts a token-only verification body and rejects a short one', () => {
    expect(emailVerifySchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true)
    expect(emailVerifySchema.safeParse({ token: 'short' }).success).toBe(false)
  })

  it('requires a password and a valid address to change the address', () => {
    expect(
      emailChangeSchema.safeParse({ password: 'x', newEmail: 'new@example.com' }).success,
    ).toBe(true)
    expect(emailChangeSchema.safeParse({ password: 'x', newEmail: 'nope' }).success).toBe(false)
    expect(emailChangeSchema.safeParse({ newEmail: 'new@example.com' }).success).toBe(false)
  })

  it('caps a bulk revoke at 100 ids and requires at least one', () => {
    expect(adminSessionsRevokeSchema.safeParse({ ids: ['sess_1'] }).success).toBe(true)
    expect(adminSessionsRevokeSchema.safeParse({ ids: [] }).success).toBe(false)
    const tooMany = Array.from({ length: 101 }, (_, index) => `sess_${index}`)
    expect(adminSessionsRevokeSchema.safeParse({ ids: tooMany }).success).toBe(false)
  })

  it('constrains the revoke reasons to the whitelist', () => {
    expect(
      adminSessionsRevokeSchema.safeParse({ ids: ['sess_1'], reason: 'admin_lockdown' }).success,
    ).toBe(true)
    expect(
      adminSessionsRevokeSchema.safeParse({ ids: ['sess_1'], reason: 'because' }).success,
    ).toBe(false)
  })

  it('accepts an invitation with an optional address and note', () => {
    const withMail = createInviteSchema.parse({
      email: 'new@example.com',
      note: 'hello',
      maxUses: 1,
      expiresInDays: 7,
      roleKey: 'member',
    })
    expect(withMail.email).toBe('new@example.com')
    const without = createInviteSchema.parse({ maxUses: 1, expiresInDays: 7, roleKey: 'member' })
    expect(without.email).toBeUndefined()
  })

  it('requires a reason for an on-behalf deletion confirmation', () => {
    expect(adminDeletionConfirmSchema.safeParse({ reason: '工单 #42' }).success).toBe(true)
    expect(adminDeletionConfirmSchema.safeParse({ reason: '' }).success).toBe(false)
  })
})

describe('error code table', () => {
  it('keeps ERROR_CODE and ERROR_STATUS in step for the five new codes', () => {
    // `ERROR_STATUS` is `Record<ErrorCode, number>`, so a missing key is a compile
    // error — but a wrong number is not, which is what this table pins.
    const expected: Record<string, number> = {
      email_not_verified: 403,
      email_already_verified: 409,
      token_invalid: 400,
      deletion_pending: 409,
      mail_disabled: 503,
    }
    for (const [code, status] of Object.entries(expected)) {
      expect(Object.values(ERROR_CODE)).toContain(code)
      expect(ERROR_STATUS[code as ErrorCode]).toBe(status)
    }
  })

  it('maps every error code to a status', () => {
    for (const code of Object.values(ERROR_CODE)) {
      expect(ERROR_STATUS[code], code).toBeTypeOf('number')
    }
  })
})
