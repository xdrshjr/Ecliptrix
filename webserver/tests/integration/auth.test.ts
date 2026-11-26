import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import * as authService from '@/server/services/authService'
import * as userService from '@/server/services/userService'
import * as settingsService from '@/server/services/settingsService'
import { getDb } from '@/server/db/client'
import { auditRepo, loginAttemptsRepo, usersRepo } from '../setup/repos'
import { resetAll } from '@/server/auth/rateLimit'
import type { AuditContext } from '@/server/services/auditService'

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-1' }
const DEVICE = { name: 'test', platform: 'win32', appVersion: '0.1.0' }

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  // A real user id: `app_settings.updated_by` is a foreign key, and a settings
  // write from an unknown actor must fail rather than invent one.
  const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  settingsService.patch({ 'security.loginMaxAttempts': 5 }, owner?.id ?? '')
})

afterEach(() => {
  harness.teardown()
})

function loginInput(identifier: string, password: string) {
  return { identifier, password, client: 'web' as const, device: DEVICE, ...CONTEXT }
}

describe('login', () => {
  it('signs the root administrator in and records the attempt', async () => {
    const result = await authService.login(loginInput('owner@example.com', 'owner-password-123'))
    expect(result.user.email).toBe('owner@example.com')
    expect(result.permissions).toEqual(['*'])
    expect(result.tokens.accessToken).toBeTruthy()
    expect(result.tokens.refreshToken).toBeTruthy()

    const attempts = loginAttemptsRepo.listRecent(getDb(), 'owner@example.com')
    expect(attempts[0]?.success).toBe(1)
  })

  it('accepts the username form of the identifier', async () => {
    const result = await authService.login(loginInput('owner', 'owner-password-123'))
    expect(result.user.email).toBe('owner@example.com')
  })

  it('rejects a wrong password with the generic credential error', async () => {
    await expect(
      authService.login(loginInput('owner@example.com', 'wrong-password-123')),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('answers an unknown identifier with the same error (no enumeration)', async () => {
    const unknown = await authService
      .login(loginInput('nobody@example.com', 'whatever-password'))
      .catch((error: { code: string }) => error)
    const wrong = await authService
      .login(loginInput('owner@example.com', 'whatever-password'))
      .catch((error: { code: string }) => error)
    expect(unknown).toMatchObject({ code: 'invalid_credentials' })
    expect(wrong).toMatchObject({ code: 'invalid_credentials' })
  })

  it('locks the account after the configured number of failures and reports retry-after', async () => {
    const attempts = 5
    for (let index = 0; index < attempts; index += 1) {
      // From the third failure on, the escalation demands a challenge. A browser
      // user sees the captcha field and solves it, so this loop does the same:
      // omitting it would only assert the escalation, never the lockout that the
      // escalation sits in front of.
      await authService
        .login({ ...loginInput('owner@example.com', 'bad-password-1'), ...issueCaptcha('login') })
        .catch(() => null)
    }
    const error = await authService
      .login(loginInput('owner@example.com', 'owner-password-123'))
      .catch((thrown: { code: string; retryAfterSeconds?: number }) => thrown)

    expect(error).toMatchObject({ code: 'account_locked' })
    expect((error as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0)
  })

  it('demands a challenge before the lockout threshold and answers the lockout after it', async () => {
    // Three failures put this identifier into the escalation band: the account is
    // not locked yet (threshold 5), but the fourth attempt must present a
    // challenge. This pins the order the two gates answer in.
    for (let index = 0; index < 3; index += 1) {
      await authService
        .login(loginInput('owner@example.com', 'bad-password-1'))
        .catch(() => null)
    }
    await expect(authService.login(loginInput('owner@example.com', 'bad-password-1'))).rejects.toMatchObject(
      { code: 'captcha_required' },
    )
    // Solving it does not grant a pass: the password is still checked, and the
    // two further failures reach the lockout.
    await authService
      .login({ ...loginInput('owner@example.com', 'bad-password-1'), ...issueCaptcha('login') })
      .catch(() => null)
    await authService
      .login({ ...loginInput('owner@example.com', 'bad-password-1'), ...issueCaptcha('login') })
      .catch(() => null)
    // A locked account answers the lockout, not another puzzle: asking a user who
    // cannot sign in regardless to solve one more puzzle would be noise.
    await expect(
      authService.login({
        ...loginInput('owner@example.com', 'owner-password-123'),
      }),
    ).rejects.toMatchObject({ code: 'account_locked' })
  })

  it('clears the failure counter after a successful sign-in', async () => {
    await authService.login(loginInput('owner@example.com', 'bad-password-1')).catch(() => null)
    await authService.login(loginInput('owner@example.com', 'bad-password-2')).catch(() => null)
    await authService.login(loginInput('owner@example.com', 'owner-password-123'))

    const user = usersRepo.findById(getDb(), '') ?? usersRepo.findByEmailOrUsername(
      getDb(),
      'owner@example.com',
      'owner',
    )
    expect(user?.failed_login_count).toBe(0)
  })

  it('refuses a suspended account', async () => {
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    expect(owner).toBeDefined()
    const created = await userService.createUser(
      {
        email: 'member@example.com',
        username: 'member',
        password: 'quiet meadow lantern drift',
        status: 'suspended',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
      },
      auditContext('owner-1'),
    )
    expect(created.user.status).toBe('suspended')

    await expect(
      authService.login(loginInput('member@example.com', 'quiet meadow lantern drift')),
    ).rejects.toMatchObject({ code: 'account_suspended' })
  })

  it('writes an audit row for a successful sign-in', async () => {
    await authService.login(loginInput('owner@example.com', 'owner-password-123'))
    const rows = auditRepo.list(getDb(), { action: 'auth.login' }, { page: 1, pageSize: 10, offset: 0 })
    expect(rows.total).toBe(1)
  })
})

describe('register', () => {
  const input = {
    email: 'newcomer@example.com',
    password: 'a-long-and-unique-passphrase',
    username: 'newcomer',
    client: 'web' as const,
    device: DEVICE,
    ...CONTEXT,
  }

  it('creates an active member account and signs it in', async () => {
    const result = await authService.register({ ...input, ...issueCaptcha() })
    expect(result.user.status).toBe('active')
    expect(result.role.key).toBe('member')
    expect(result.permissions).toEqual([])
  })

  it('rejects registration when the switch is off', async () => {
    setSetting({ 'registration.enabled': false })
    await expect(authService.register(input)).rejects.toMatchObject({
      code: 'registration_disabled',
    })
  })

  it('requires an invite code when configured', async () => {
    setSetting({ 'invite.required': true })
    await expect(authService.register(input)).rejects.toMatchObject({ code: 'invite_required' })
    await expect(
      authService.register({ ...input, inviteCode: 'ECL-AAAA-BBBB-CCCC', ...issueCaptcha() }),
    ).rejects.toMatchObject({ code: 'invite_invalid' })
  })

  it('rejects a duplicate email with email_taken', async () => {
    setSetting({ 'registration.enabled': true })
    await authService.register({ ...input, ...issueCaptcha() })
    await expect(
      authService.register({ ...input, username: 'other-name', ...issueCaptcha() }),
    ).rejects.toMatchObject({ code: 'email_taken' })
  })

  it('rejects a weak password with the policy reasons', async () => {
    const error = await authService
      .register({ ...input, password: 'password123', ...issueCaptcha() })
      .catch((thrown: { code: string; details?: { reasons?: string[] } }) => thrown)
    expect(error).toMatchObject({ code: 'weak_password' })
    expect((error as { details?: { reasons?: string[] } }).details?.reasons).toContain('too_weak')
  })
})

describe('logout and password change', () => {
  it('revokes the session on logout', async () => {
    const login = await authService.login(loginInput('owner@example.com', 'owner-password-123'))
    authService.logout(login.sessionId, login.user.id, 'req-2', '127.0.0.1')

    const rows = auditRepo.list(getDb(), { action: 'auth.logout' }, { page: 1, pageSize: 5, offset: 0 })
    expect(rows.total).toBe(1)
  })

  it('requires the current password to change it', async () => {
    const login = await authService.login(loginInput('owner@example.com', 'owner-password-123'))
    await expect(
      authService.changePassword({
        userId: login.user.id,
        currentPassword: 'not-the-current-one',
        newPassword: 'another-long-passphrase',
        signOutOtherSessions: false,
        currentSessionId: login.sessionId,
        requestId: 'req-3',
        ip: '127.0.0.1',
      }),
    ).rejects.toMatchObject({ code: 'password_mismatch' })
  })

  it('changes the password and invalidates the refresh token', async () => {
    const login = await authService.login(loginInput('owner@example.com', 'owner-password-123'))
    await authService.changePassword({
      userId: login.user.id,
      currentPassword: 'owner-password-123',
      newPassword: 'a-brand-new-long-passphrase',
      signOutOtherSessions: true,
      currentSessionId: login.sessionId,
      requestId: 'req-4',
      ip: '127.0.0.1',
    })

    await expect(
      authService.login(loginInput('owner@example.com', 'owner-password-123')),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    const relogin = await authService.login(
      loginInput('owner@example.com', 'a-brand-new-long-passphrase'),
    )
    expect(relogin.user.id).toBe(login.user.id)
  })
})

function setSetting(patch: Record<string, unknown>): void {
  const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  if (!owner) throw new Error('seed owner missing')
  settingsService.patch(patch, owner.id)
}

function auditContext(actorUserId: string): AuditContext {
  return { actorUserId, actorLabel: 'test@example.com', ip: '127.0.0.1', requestId: 'req-x' }
}
