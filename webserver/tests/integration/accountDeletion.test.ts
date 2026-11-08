import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import * as profileService from '@/server/services/profileService'
import * as sessionService from '@/server/services/sessionService'
import * as settingsService from '@/server/services/settingsService'
import * as deletionRepo from '@/server/db/repositories/deletionRequestsRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { REVOKE_REASON } from '@/server/auth/constants'
import { hashToken } from '@/server/auth/tokens'
import { getConfig } from '@/server/config'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * The deletion state machine.
 *
 * Three regression cases from the design review live here and each one was a 500 or
 * a locked-out user in the pre-review design:
 *  - two consecutive no-SMTP requests (the nullable `token_hash` + partial index);
 *  - a re-request while one is live (cancel-then-insert order);
 *  - the audit metadata must never contain a plaintext address.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-del' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet river stone meadow'
const OWNER_PASSWORD = 'owner-password-123'

let harness: TestHarness
let actor: AuditContext
let user: UserRow

async function setUp(env: Record<string, string> = {}) {
  harness = await createHarness(env)
  resetAll()
  const result = await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'deletion-device-key' },
    ...CONTEXT,
  })
  user = result.user
  actor = { actorUserId: user.id, actorLabel: user.email, ip: '127.0.0.1', requestId: 'req-del' }
}

function reloadUser(id = user.id): UserRow {
  const row = usersRepo.findById(getDb(), id)
  if (!row) throw new Error('user vanished')
  return row
}

function request(reason = '不再使用') {
  return accountDeletionService.request(
    reloadUser(),
    { password: PASSWORD, reason },
    { ip: '127.0.0.1', requestId: 'req-del', audit: actor },
  )
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

describe('deletion with mail configured', () => {
  beforeEach(async () => {
    await setUp({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2' })
  })

  it('stores awaiting_confirmation and mails a confirm link', async () => {
    const result = request()
    expect(result.requiresConfirmation).toBe(true)
    expect(result.scheduledFor).toBeNull()
    const live = deletionRepo.findLiveByUser(getDb(), user.id)
    expect(live?.status).toBe('awaiting_confirmation')
    expect(live?.token_hash).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const rows = outboxRepo.list(getDb(), { template: 'deletion-confirm' }, { page: 1, pageSize: 5, offset: 0 })
    expect(rows.total).toBe(1)
  })

  it('keeps the plaintext address out of the audit metadata', () => {
    request()
    const rows = auditRepo.list(
      getDb(),
      { action: 'account.deletion_requested' },
      { page: 1, pageSize: 5, offset: 0 },
    )
    const metadata = rows.rows[0]?.metadata ?? ''
    expect(metadata).not.toContain('member@example.com')
    expect(metadata).toContain('***@example.com')
  })

  it('schedules for now + grace when the link is confirmed', () => {
    request()
    const live = deletionRepo.findLiveByUser(getDb(), user.id)
    const plaintext = 'confirm-token-abcdefghij'
    // Re-hash the stored digest so the test can present the plaintext.
    getDb()
      .prepare('UPDATE account_deletion_requests SET token_hash = ? WHERE id = ?')
      .run(hashToken(getConfig().sessionSecret, plaintext), live?.id ?? '')

    const graceHours = settingsService.getNumber('account.deletionGraceHours')
    const confirmed = accountDeletionService.confirm(plaintext, {
      ip: '1.2.3.4',
      requestId: 'req-confirm',
    })
    const scheduledFor = new Date(confirmed.scheduledFor).getTime()
    expect(scheduledFor).toBeGreaterThan(Date.now() + (graceHours - 1) * 3_600_000)
    expect(deletionRepo.findById(getDb(), live?.id ?? '')?.status).toBe('scheduled')
  })

  it('retires the confirmation link and never postpones an already-scheduled deletion', () => {
    request()
    const live = deletionRepo.findLiveByUser(getDb(), user.id)
    const plaintext = 'confirm-token-replay-1'
    getDb()
      .prepare('UPDATE account_deletion_requests SET token_hash = ? WHERE id = ?')
      .run(hashToken(getConfig().sessionSecret, plaintext), live?.id ?? '')

    const first = accountDeletionService.confirm(plaintext, { ip: '1.2.3.4', requestId: 'r1' })
    // The row is scheduled and its digest is gone: the mailed link is single-use.
    expect(deletionRepo.findById(getDb(), live?.id ?? '')?.token_hash).toBeNull()

    // Presenting the same link again cannot move the deadline, which is what a
    // recomputed `now + grace` did on every click.
    expect(() =>
      accountDeletionService.confirm(plaintext, { ip: '1.2.3.4', requestId: 'r2' }),
    ).toThrowError(expect.objectContaining({ code: 'token_invalid' }))
    const row = deletionRepo.findById(getDb(), live?.id ?? '')
    expect(new Date(row?.scheduled_for ?? 0).toISOString()).toBe(first.scheduledFor)
    expect(row?.status).toBe('scheduled')
  })

  it('cancels a live request', () => {
    request()
    accountDeletionService.cancel(reloadUser(), actor)
    const live = deletionRepo.findLiveByUser(getDb(), user.id)
    expect(live).toBeUndefined()
    const rows = deletionRepo.listForUser(getDb(), user.id)
    expect(rows[0]?.status).toBe('cancelled')
  })

  it('refuses a second request while one is live (deletion_pending)', () => {
    request()
    expect(() => request()).toThrowError(expect.objectContaining({ code: 'deletion_pending' }))
  })
})

describe('deletion with no smtp', () => {
  beforeEach(async () => {
    await setUp()
  })

  it('schedules immediately and says no confirmation is needed', () => {
    const result = request()
    expect(result.requiresConfirmation).toBe(false)
    expect(result.scheduledFor).not.toBeNull()
    const live = deletionRepo.findLiveByUser(getDb(), user.id)
    expect(live?.status).toBe('scheduled')
    expect(live?.token_hash).toBeNull()
  })

  it('survives two consecutive no-smtp requests without a unique violation', () => {
    // First request, then cancel it, then request again: the nullable token_hash
    // is what keeps the second insert from colliding on ''.
    request()
    accountDeletionService.cancel(reloadUser(), actor)
    expect(() => request()).not.toThrow()
    const rows = deletionRepo.listForUser(getDb(), user.id)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.token_hash === null)).toBe(true)
  })

  it('cancels the previous live row before inserting a replacement', () => {
    const first = request()
    // `allowExistingPending` is the ONLY path that reaches the insert with a live
    // row (the public route answers `409 deletion_pending` instead), so a test that
    // cancelled the row by hand first proved nothing about the ordering. This one
    // drives the real path: `idx_deletion_live` would reject a second live row, so
    // a regression to insert-before-cancel fails here with a constraint error.
    const second = accountDeletionService.request(
      reloadUser(),
      { password: PASSWORD, reason: '重新申请' },
      { ip: '127.0.0.1', requestId: 'req-del-2', audit: actor },
      { allowExistingPending: true },
    )
    const all = deletionRepo.listForUser(getDb(), user.id)
    expect(all.filter((entry) => entry.status === 'scheduled')).toHaveLength(1)
    expect(all.find((entry) => entry.id === first.requestId)?.status).toBe('cancelled')
    expect(second.requestId).not.toBe(first.requestId)
  })

  it('lets an administrator confirm on behalf of a user who lost their mailbox', () => {
    request()
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    const result = accountDeletionService.confirmByAdmin(user.id, '用户无法收信，工单 #42', {
      actorUserId: owner?.id ?? '',
      actorLabel: 'owner@example.com',
      ip: '127.0.0.1',
      requestId: 'req-admin',
    })
    expect(result.status).toBe('scheduled')
    const audit = auditRepo.list(
      getDb(),
      { action: 'account.deletion_confirmed_by_admin' },
      { page: 1, pageSize: 5, offset: 0 },
    )
    expect(audit.total).toBe(1)
  })

  it('refuses to schedule an account with no live request', () => {
    expect(() =>
      accountDeletionService.confirmByAdmin(user.id, 'no request', actor),
    ).toThrowError(expect.objectContaining({ code: 'conflict' }))
  })
})

describe('deletion protection rules', () => {
  beforeEach(async () => {
    await setUp()
  })

  it('refuses the owner account', async () => {
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    expect(owner).toBeDefined()
    await expect(
      profileService.requestAccountDeletion(
        owner?.id ?? '',
        { password: OWNER_PASSWORD },
        { ip: '1.1.1.1', requestId: 'r', audit: { ...actor, actorUserId: owner?.id ?? '' } },
      ),
    ).rejects.toMatchObject({ code: 'cannot_modify_owner' })
  })

  it('refuses the last account that can administer users', async () => {
    // Promote the member to admin, then demote the owner so the member is last.
    const db = getDb()
    const adminRole = db.prepare("SELECT id FROM roles WHERE key = 'admin'").get() as { id: string }
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(adminRole.id, user.id)
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    const memberRole = db.prepare("SELECT id FROM roles WHERE key = 'member'").get() as { id: string }
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(memberRole.id, owner?.id ?? '')

    await expect(
      profileService.requestAccountDeletion(
        user.id,
        { password: PASSWORD },
        { ip: '1.1.1.1', requestId: 'r', audit: actor },
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('requires the correct password', async () => {
    await expect(
      profileService.requestAccountDeletion(
        user.id,
        { password: 'wrong-password-1' },
        { ip: '1.1.1.1', requestId: 'r', audit: actor },
      ),
    ).rejects.toMatchObject({ code: 'password_mismatch' })
  })
})

describe('deletion sweep', () => {
  beforeEach(async () => {
    await setUp()
  })

  it('anonymises the account, revokes every session and completes the request', () => {
    const created = request()
    const before = reloadUser()
    const result = accountDeletionService.sweepDue(Date.now() + 73 * 3_600_000, 10)
    expect(result.deleted).toBe(1)

    const after = reloadUser()
    expect(after.status).toBe('deleted')
    expect(after.deleted_at).not.toBeNull()
    expect(after.email).toMatch(/^deleted\+[0-9a-z]{8}@deleted\.invalid$/)
    expect(after.username).toMatch(/^deleted_/)
    expect(after.display_name).toBe('已注销账号')
    expect(after.password_hash).not.toBe(before.password_hash)
    expect(after.email_verified_at).toBeNull()

    // Every session is revoked with the self-service reason, not the admin one.
    const sessions = sessionsRepo.listForUser(getDb(), user.id, true)
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((row) => row.revoked_reason === REVOKE_REASON.accountDeleted)).toBe(true)

    expect(deletionRepo.findById(getDb(), created.requestId)?.status).toBe('completed')
    const audit = auditRepo.list(getDb(), { action: 'account.deleted' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBe(1)
    expect(audit.rows[0]?.metadata).not.toContain('member@example.com')
  })

  it('leaves the account signed out immediately after the sweep', async () => {
    const login = await authService.login({
      identifier: 'member@example.com',
      password: PASSWORD,
      client: 'desktop',
      device: { ...DEVICE, deviceKey: 'sweep-device-key' },
      ip: '10.1.1.1',
      userAgent: 'vitest',
      requestId: 'req-login',
    })
    request()
    accountDeletionService.sweepDue(Date.now() + 73 * 3_600_000, 10)

    // The session row survives but is revoked, which is what the guard reports as
    // `401 session_revoked` with `details.reason = account_deleted`.
    const session = sessionService.sessionFromAccessToken(login.tokens.accessToken)
    expect(session?.revoked_at).not.toBeNull()
    expect(session?.revoked_reason).toBe(REVOKE_REASON.accountDeleted)
  })

  it('is idempotent and skips requests that are not due yet', () => {
    request()
    expect(accountDeletionService.sweepDue(Date.now(), 10).deleted).toBe(0)
    const first = accountDeletionService.sweepDue(Date.now() + 73 * 3_600_000, 10)
    const second = accountDeletionService.sweepDue(Date.now() + 73 * 3_600_000, 10)
    expect(first.deleted).toBe(1)
    expect(second.deleted).toBe(0)
  })

  it('keeps the deleted account unable to sign in with the old password', async () => {
    request()
    accountDeletionService.sweepDue(Date.now() + 73 * 3_600_000, 10)
    await expect(
      authService.login({
        identifier: 'deleted+' + user.id.slice(0, 8) + '@deleted.invalid',
        password: PASSWORD,
        client: 'web',
        device: DEVICE,
        ip: '10.1.1.2',
        userAgent: 'vitest',
        requestId: 'req-after',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })
})
