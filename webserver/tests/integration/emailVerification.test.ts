import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import * as settingsService from '@/server/services/settingsService'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import * as tokensRepo from '@/server/db/repositories/emailActionTokensRepo'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { hashToken } from '@/server/auth/tokens'
import { getConfig } from '@/server/config'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * Email verification.
 *
 * The three review-driven cases are the point of this file:
 *  - `resend after the previous token expired still inserts` (the partial unique
 *    index does not look at `expires_at`);
 *  - `register is never blocked by verificationRequired` (the gate would otherwise
 *    close registration for everyone);
 *  - `verificationRequired blocks desktop login only`.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-verify' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const MEMBER_PASSWORD = 'quiet river stone meadow'

let harness: TestHarness
let actor: AuditContext

beforeEach(async () => {
  // SMTP without a reachable host: sends fail fast but the pipeline runs, so the
  // outbox assertions are meaningful and no network call can hang the suite.
  harness = await createHarness({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2' })
  resetAll()
  const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  actor = {
    actorUserId: owner?.id ?? '',
    actorLabel: 'vitest',
    ip: '127.0.0.1',
    requestId: 'req-verify',
  }
})

afterEach(async () => {
  // Fire-and-forget mails must finish before the per-case database closes.
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

/** A member registered through the real service, so the mail is really queued. */
async function registerMember(email = 'member@example.com'): Promise<UserRow> {
  const result = await authService.register({
    email,
    password: MEMBER_PASSWORD,
    username: email.split('@')[0],
    client: 'web',
    device: DEVICE,
    ...CONTEXT,
    ...issueCaptcha(),
  })
  return result.user
}

/** The plaintext token cannot be recovered from the hash, so mint one directly. */
function issueToken(user: UserRow, purpose: 'verify' | 'change_email', expiresInMs = 3_600_000, email = '') {
  const plaintext = `token-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  tokensRepo.issue(getDb(), {
    id: `tok-${Math.random().toString(36).slice(2)}`,
    userId: user.id,
    purpose,
    emailNormalized: email,
    tokenHash: hashToken(getConfig().sessionSecret, plaintext),
    expiresAt: Date.now() + expiresInMs,
    ip: '127.0.0.1',
    now: Date.now(),
  })
  return plaintext
}

function reload(id: string): UserRow {
  const row = usersRepo.findById(getDb(), id)
  if (!row) throw new Error('user vanished')
  return row
}

describe('email verification', () => {
  it('queues a verify-email outbox row on registration', async () => {
    const user = await registerMember()
    const rows = outboxRepo.list(getDb(), { template: 'verify-email' }, { page: 1, pageSize: 5, offset: 0 })
    expect(rows.total).toBe(1)
    expect(rows.rows[0]?.to_user_id).toBe(user.id)
    // The stored body never carries the live token.
    expect(rows.rows[0]?.body_text).toContain('token=***')
    expect(rows.rows[0]?.retryable).toBe(0)
  })

  it('verifies an address and writes auth.email_verified', async () => {
    const user = await registerMember()
    const token = issueToken(user, 'verify')
    const result = await emailVerificationService.consumeVerificationToken(token, {
      ip: '127.0.0.1',
      requestId: 'req-v1',
    })
    expect(result.changed).toBe(false)
    expect(result.email).toBe('member@example.com')
    expect(reload(user.id).email_verified_at).not.toBeNull()
    const audit = auditRepo.list(getDb(), { action: 'auth.email_verified' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBe(1)
  })

  it('rejects an expired token with token_invalid', async () => {
    const user = await registerMember()
    const token = issueToken(user, 'verify', -1000)
    await expect(
      emailVerificationService.consumeVerificationToken(token, { ip: '1.1.1.1', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })

  it('rejects an already used token with token_invalid', async () => {
    const user = await registerMember()
    const token = issueToken(user, 'verify')
    await emailVerificationService.consumeVerificationToken(token, { ip: '1.1.1.1', requestId: 'r' })
    usersRepo.update(getDb(), user.id, { email_verified_at: null } as Partial<UserRow>, Date.now())
    await expect(
      emailVerificationService.consumeVerificationToken(token, { ip: '1.1.1.1', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })

  it('rejects an unknown token the same way (no oracle)', async () => {
    await expect(
      emailVerificationService.consumeVerificationToken('not-a-real-token-value', {
        ip: '1.1.1.1',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })

  it('resend invalidates the previous token', async () => {
    const user = await registerMember()
    const first = issueToken(user, 'verify')
    emailVerificationService.resendVerification(user, {
      ip: '127.0.0.1',
      audit: actor,
    })
    await expect(
      emailVerificationService.consumeVerificationToken(first, { ip: '1.1.1.1', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'token_invalid' })
  })

  it('resend after the previous token expired still inserts (partial index)', async () => {
    const user = await registerMember()
    // An expired-but-unused row occupies the (user, purpose) slot.
    issueToken(user, 'verify', -1000)
    const result = emailVerificationService.resendVerification(user, { ip: '127.0.0.1', audit: actor })
    expect(result.expiresAt).toBeTruthy()
    expect(tokensRepo.findLive(getDb(), user.id, 'verify')).toBeDefined()
  })

  it('refuses to resend for an already verified address', async () => {
    const user = await registerMember()
    usersRepo.update(getDb(), user.id, { email_verified_at: Date.now() } as Partial<UserRow>, Date.now())
    expect(() =>
      emailVerificationService.resendVerification(reload(user.id), { ip: '127.0.0.1', audit: actor }),
    ).toThrowError(expect.objectContaining({ code: 'email_already_verified' }))
  })

  it('lets an administrator mark an address verified and audits it', async () => {
    const user = await registerMember()
    const result = emailVerificationService.markVerifiedByAdmin(user.id, actor)
    expect(result.emailVerifiedAt).toBeTruthy()
    expect(reload(user.id).email_verified_at).not.toBeNull()
    const audit = auditRepo.list(
      getDb(),
      { action: 'user.email_verified_by_admin' },
      { page: 1, pageSize: 5, offset: 0 },
    )
    expect(audit.total).toBe(1)
  })

  it('blocks an unverified desktop login when the policy is on, and never the web one', async () => {
    const user = await registerMember()
    // The write side refuses to arm the policy without SMTP; enable it directly.
    settingsService.patch({ 'mail.verificationRequired': true }, actor.actorUserId ?? '')

    await expect(
      authService.login({
        identifier: user.email,
        password: MEMBER_PASSWORD,
        client: 'desktop',
        clientVersion: '1.0.0',
        device: { ...DEVICE, deviceKey: 'device-key-abcdefgh' },
        ip: '10.0.0.9',
        userAgent: 'vitest',
        requestId: 'req-gate',
      }),
    ).rejects.toMatchObject({ code: 'email_not_verified' })

    // A browser login is what the user needs in order to read the mail.
    const web = await authService.login({
      identifier: user.email,
      password: MEMBER_PASSWORD,
      client: 'web',
      device: DEVICE,
      ip: '10.0.0.10',
      userAgent: 'vitest',
      requestId: 'req-gate-web',
    })
    expect(web.user.id).toBe(user.id)
  })

  it('never blocks registration even when the policy is on', async () => {
    settingsService.patch({ 'mail.verificationRequired': true }, actor.actorUserId ?? '')
    const result = await authService.register({
      email: 'newcomer@example.com',
      password: MEMBER_PASSWORD,
      username: 'newcomer',
      client: 'desktop',
      clientVersion: '1.0.0',
      device: { ...DEVICE, deviceKey: 'device-key-newcomer' },
      ...CONTEXT,
      ...issueCaptcha(),
    })
    expect(result.user.email_verified_at).toBeNull()
  })

  it('exempts administrators from the verification gate', async () => {
    settingsService.patch({ 'mail.verificationRequired': true }, actor.actorUserId ?? '')
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    expect(owner?.email_verified_at).toBeNull()
    const login = await authService.login({
      identifier: 'owner@example.com',
      password: 'owner-password-123',
      client: 'desktop',
      clientVersion: '1.0.0',
      device: { ...DEVICE, deviceKey: 'owner-device-key-1' },
      ip: '10.0.0.11',
      userAgent: 'vitest',
      requestId: 'req-owner',
    })
    expect(login.user.id).toBe(owner?.id)
  })

  it('keeps the policy off when the deployment has no smtp (read-side clamp)', async () => {
    harness.teardown()
    harness = await createHarness()
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    // Write side refuses …
    expect(() =>
      settingsService.patch({ 'mail.verificationRequired': true }, owner?.id ?? ''),
    ).toThrowError(expect.objectContaining({ code: 'validation_failed' }))
    // … and the read side would clamp a stored true from a restored backup.
    const db = getDb()
    db.prepare("UPDATE app_settings SET value = 'true' WHERE key = 'mail.verificationRequired'").run()
    expect(settingsService.all()['mail.verificationRequired']).toBe(false)
  })
})
