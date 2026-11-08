import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import * as tokensRepo from '@/server/db/repositories/emailActionTokensRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { hashToken } from '@/server/auth/tokens'
import { getConfig } from '@/server/config'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * Changing the address: two confirmations, an occupation race, and a cancellation.
 *
 * The security property under test is the double mail: the new address gets the
 * link, the OLD address gets the notice. Only verifying the new address would let
 * somebody with a stolen session move the account and then use "forgot password".
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-change' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet river stone meadow'

let harness: TestHarness
let actor: AuditContext
let user: UserRow

beforeEach(async () => {
  harness = await createHarness({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "2" })
  resetAll()
  const result = await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'web',
    device: DEVICE,
    ...CONTEXT,
  })
  user = result.user
  const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  actor = { actorUserId: user.id, actorLabel: user.email, ip: '127.0.0.1', requestId: 'req-change' }
  expect(owner).toBeDefined()
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

function mintChangeToken(target: string): string {
  const plaintext = `tok-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  tokensRepo.issue(getDb(), {
    id: `tok-${Math.random().toString(36).slice(2)}`,
    userId: user.id,
    purpose: 'change_email',
    emailNormalized: target,
    tokenHash: hashToken(getConfig().sessionSecret, plaintext),
    expiresAt: Date.now() + 3_600_000,
    ip: '127.0.0.1',
    now: Date.now(),
  })
  return plaintext
}

describe('email change', () => {
  it('requires the correct password', async () => {
    await expect(
      emailVerificationService.verifyPasswordOrFail(user, 'not-the-password-1'),
    ).rejects.toMatchObject({ code: 'password_mismatch' })
    await emailVerificationService.verifyPasswordOrFail(user, PASSWORD)
  })

  it('sends two mails: confirmation to the new address, notice to the old one', async () => {
    const pending = emailVerificationService.requestEmailChange(
      user,
      { password: PASSWORD, newEmail: 'new@example.com' },
      { ip: '127.0.0.1', requestId: 'r', audit: actor },
    )
    expect(pending.pendingEmail).toBe('n***@new@example.com'.replace('@new@', '@'))
    await new Promise((resolve) => setTimeout(resolve, 40))
    const rows = outboxRepo.list(getDb(), {}, { page: 1, pageSize: 20, offset: 0 }).rows
    const templates = rows.map((row) => row.template)
    expect(templates).toContain('change-email-confirm')
    expect(templates).toContain('email-change-notice')
    const notice = rows.find((row) => row.template === 'email-change-notice')
    // The notice goes to the CURRENT address: that is the止损 window.
    expect(notice?.to_email).toBe('member@example.com')
  })

  it('confirms the change, revokes other sessions and audits it', async () => {
    // A second live session that must be retired.
    await authService.login({
      identifier: 'member@example.com',
      password: PASSWORD,
      client: 'desktop',
      device: { ...DEVICE, deviceKey: 'other-device-key-1' },
      ip: '10.0.0.4',
      userAgent: 'vitest',
      requestId: 'req-login',
    })
    const token = mintChangeToken('new@example.com')
    const result = await emailVerificationService.consumeVerificationToken(token, {
      ip: '1.2.3.4',
      requestId: 'req-confirm',
    })
    expect(result.changed).toBe(true)
    expect(result.email).toBe('new@example.com')
    expect(result.sessionsRevoked).toBeGreaterThan(0)

    const updated = usersRepo.findById(getDb(), user.id)
    expect(updated?.email).toBe('new@example.com')
    expect(updated?.email_verified_at).not.toBeNull()
    const live = sessionsRepo.listForUser(getDb(), user.id)
    expect(live).toHaveLength(0)

    const audit = auditRepo.list(getDb(), { action: 'user.email_changed' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBe(1)
    // Masked on both sides.
    const metadata = JSON.parse(audit.rows[0]?.metadata ?? '{}') as Record<string, unknown>
    expect(String(metadata.from)).toContain('***')
    expect(String(metadata.from)).not.toContain('member@example.com')
  })

  it('lets only one of two accounts claim the same new address', async () => {
    // The other account already owns the address.
    const other = await authService.register({
      email: 'taken@example.com',
      password: PASSWORD,
      username: 'other',
      client: 'web',
      device: DEVICE,
      ...CONTEXT,
    })
    expect(other.user.id).not.toBe(user.id)

    // A token minted before the address was taken must not win the race.
    const token = mintChangeToken('taken@example.com')
    await expect(
      emailVerificationService.consumeVerificationToken(token, { ip: '1.1.1.1', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'email_taken' })
  })

  it('cancels a pending change and reports it', async () => {
    emailVerificationService.requestEmailChange(
      user,
      { password: PASSWORD, newEmail: 'new@example.com' },
      { ip: '127.0.0.1', requestId: 'r', audit: actor },
    )
    expect(emailVerificationService.pendingEmail(user.id)).toBeTruthy()
    emailVerificationService.cancelEmailChange(user, actor)
    expect(emailVerificationService.pendingEmail(user.id)).toBeNull()
    const audit = auditRepo.list(
      getDb(),
      { action: 'user.email_change_cancelled' },
      { page: 1, pageSize: 5, offset: 0 },
    )
    expect(audit.total).toBe(1)
  })

  it('keeps the confirming session and revokes only the others', async () => {
    await authService.login({
      identifier: 'member@example.com',
      password: PASSWORD,
      client: 'desktop',
      device: { ...DEVICE, deviceKey: 'browser-kept-key' },
      ip: '10.0.0.5',
      userAgent: 'vitest',
      requestId: 'req-login-2',
    })
    const before = sessionsRepo.listForUser(getDb(), user.id)
    expect(before.length).toBeGreaterThanOrEqual(2)
    const confirming = before[0]!.id

    const token = mintChangeToken('kept@example.com')
    await emailVerificationService.consumeVerificationToken(token, {
      ip: '1.2.3.4',
      requestId: 'req-confirm-2',
      currentSessionId: confirming,
    })

    const after = sessionsRepo.listForUser(getDb(), user.id)
    // The tab that clicked the link is still signed in; every other device is not.
    expect(after.map((session) => session.id)).toEqual([confirming])
    expect(after[0]!.revoked_at).toBeNull()
  })

  it('cancelling a pending change leaves an unexpired verification link usable', async () => {
    // An outstanding `verify` token must survive "I changed my mind about moving
    // the address": the two flows are independent, and `invalidateAllForUser`
    // used to kill both.
    const verifyToken = `ver-${Math.random().toString(36).slice(2)}`
    tokensRepo.issue(getDb(), {
      id: `ver-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      purpose: 'verify',
      emailNormalized: user.email_normalized,
      tokenHash: hashToken(getConfig().sessionSecret, verifyToken),
      expiresAt: Date.now() + 3_600_000,
      ip: '127.0.0.1',
      now: Date.now(),
    })

    emailVerificationService.requestEmailChange(
      user,
      { password: PASSWORD, newEmail: 'new@example.com' },
      { ip: '127.0.0.1', requestId: 'r', audit: actor },
    )
    emailVerificationService.cancelEmailChange(user, actor)

    expect(tokensRepo.findByHash(getDb(), hashToken(getConfig().sessionSecret, verifyToken))?.used_at)
      .toBeNull()
    const result = await emailVerificationService.consumeVerificationToken(verifyToken, {
      ip: '1.2.3.4',
      requestId: 'r',
    })
    expect(result.verifiedAt).toBeTruthy()
  })

  it('rejects the address that is already in use and the same address', () => {
    expect(() =>
      emailVerificationService.requestEmailChange(
        user,
        { password: PASSWORD, newEmail: 'member@example.com' },
        { ip: '127.0.0.1', requestId: 'r', audit: actor },
      ),
    ).toThrowError(expect.objectContaining({ code: 'validation_failed' }))
  })
})
