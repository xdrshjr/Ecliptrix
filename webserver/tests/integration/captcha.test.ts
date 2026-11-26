import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha, wrongAnswerFor } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as captchaService from '@/server/services/captchaService'
import * as loginAttemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
import * as settingsService from '@/server/services/settingsService'
import { GET as issueRoute } from '@/app/api/v1/auth/captcha/route'

/**
 * Human verification, end to end against a real database.
 *
 * The gate is mandatory for registration (spec G-1) and escalating for login
 * (§3.2.4), so the interesting failures are ordering ones: consume-before-validate,
 * single-use, and the escalation's two counting dimensions. Every case here drives
 * the real service — nothing is mocked, per the project rule that schema, crypto and
 * ordering paths get real integration coverage.
 */

const CONTEXT = { ip: '10.20.0.1', userAgent: 'vitest', requestId: 'req-captcha' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet meadow lantern drift'

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
})

afterEach(() => {
  harness.teardown()
})

function registerInput(email = 'newcomer@example.com') {
  return {
    email,
    password: PASSWORD,
    username: email.split('@')[0],
    client: 'web' as const,
    device: DEVICE,
    ...CONTEXT,
  }
}

function challengeRow(id: string) {
  return getDb()
    .prepare('SELECT * FROM captcha_challenges WHERE id = ?')
    .get(id) as
    | { answer_hash: string; attempts: number; consumed_at: number | null; expires_at: number }
    | undefined
}

describe('registration gate', () => {
  it('refuses a sign-up with no challenge and creates nothing (AC-01)', async () => {
    const before = usersRepo.countAll(getDb())
    await expect(authService.register(registerInput())).rejects.toMatchObject({
      code: 'captcha_required',
    })
    expect(usersRepo.countAll(getDb())).toBe(before)
    expect(usersRepo.emailExists(getDb(), 'newcomer@example.com')).toBe(false)
  })

  it('accepts the right answer and creates the account (AC-03)', async () => {
    const result = await authService.register({ ...registerInput(), ...issueCaptcha() })
    expect(result.user.status).toBe('active')
    expect(result.role.key).toBe('member')
  })

  it('counts down remaining attempts on a wrong answer (AC-02)', async () => {
    const issued = issueCaptcha()
    const error = await authService
      .register({ ...registerInput(), captchaId: issued.captchaId, captchaAnswer: wrongAnswerFor(issued) })
      .catch((thrown: { code: string; details?: { remainingAttempts?: number } }) => thrown)
    expect(error).toMatchObject({ code: 'captcha_invalid' })
    const remaining = (error as { details?: { remainingAttempts?: number } }).details?.remainingAttempts
    expect(remaining).toBeGreaterThanOrEqual(0)
    expect(challengeRow(issued.captchaId)?.attempts).toBe(1)
  })

  it('spends a challenge exactly once (AC-04, DM-1)', async () => {
    const issued = issueCaptcha()
    await authService.register({ ...registerInput(), ...issued })
    await expect(
      authService.register({ ...registerInput('second@example.com'), ...issued }),
    ).rejects.toMatchObject({ code: 'captcha_invalid' })
    expect(challengeRow(issued.captchaId)?.consumed_at).not.toBeNull()
  })

  it('rejects an expired challenge (AC-05)', async () => {
    const issued = issueCaptcha()
    getDb()
      .prepare('UPDATE captcha_challenges SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1000, issued.captchaId)
    await expect(authService.register({ ...registerInput(), ...issued })).rejects.toMatchObject({
      code: 'captcha_expired',
    })
  })

  it('stops accepting answers once the attempt budget is spent (AC-06)', async () => {
    const issued = issueCaptcha()
    const budget = challengeRow(issued.captchaId)
    expect(budget).toBeDefined()
    getDb()
      .prepare('UPDATE captcha_challenges SET attempts = max_attempts WHERE id = ?')
      .run(issued.captchaId)
    await expect(authService.register({ ...registerInput(), ...issued })).rejects.toMatchObject({
      code: 'captcha_invalid',
    })
    // A fresh challenge still works — the budget is per challenge, not per caller.
    const fresh = issueCaptcha()
    await expect(
      authService.register({ ...registerInput('fresh@example.com'), ...fresh }),
    ).resolves.toMatchObject({ user: expect.objectContaining({ status: 'active' }) })
  })

  it('refuses a challenge minted for the other purpose (AC-07)', async () => {
    const loginChallenge = issueCaptcha('login')
    await expect(
      authService.register({ ...registerInput(), ...loginChallenge }),
    ).rejects.toMatchObject({ code: 'captcha_invalid' })
  })

  it('stores no plaintext answer (DM-2)', async () => {
    const issued = issueCaptcha()
    const row = challengeRow(issued.captchaId)
    expect(row?.answer_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.answer_hash).not.toContain(issued.captchaAnswer)
  })

  it('consumes the challenge even when the address is already taken', async () => {
    // Consume-first is what closes the enumeration hole: if uniqueness were checked
    // first, a failed sign-up would leave the challenge re-usable and the same id
    // could probe "does this address exist" one attempt at a time (review R-03).
    const issued = issueCaptcha()
    await authService.register({ ...registerInput(), ...issued })
    const replay = await authService
      .register({ ...registerInput(), ...issueCaptcha() })
      .catch((thrown: { code: string }) => thrown)
    expect(replay).toMatchObject({ code: 'email_taken' })
  })
})

describe('issuing', () => {
  it('returns a debug answer only under e2e mode from loopback (R-02)', () => {
    // `createHarness` runs with NODE_ENV=test, which turns `e2eMode` on.
    const loopback = captchaService.issue('register', {
      ip: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-issue',
    })
    expect(loopback.debugAnswer).toBeTruthy()
    expect(loopback.svg.startsWith('<svg')).toBe(true)
    expect(loopback.svg).not.toContain(loopback.debugAnswer)

    const remote = captchaService.issue('register', {
      ip: '203.0.113.9',
      userAgent: 'vitest',
      requestId: 'req-issue',
    })
    expect(remote.debugAnswer).toBeUndefined()
  })

  it('serves the challenge over the public route', async () => {
    const response = await issueRoute(
      new Request('http://127.0.0.1:8787/api/v1/auth/captcha?purpose=register', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { captcha: { id: string; svg: string; length: number } }
    }
    expect(body.data.captcha.id).toBeTruthy()
    expect(body.data.captcha.svg.startsWith('<svg')).toBe(true)
    // The answer length travels with the challenge: the field's `maxLength` is
    // client-side, and a hard-coded one would refuse the last character of a
    // longer challenge (see `IssuedCaptcha.length`).
    expect(body.data.captcha.length).toBe(settingsService.getNumber('captcha.length'))
  })

  it('stops issuing once the caller has spent its hourly budget (AC-09)', () => {
    // `LIMITS.captchaIssue` is 60/h. Also the table-growth ceiling: one row per
    // issue, and the retention sweep assumes a bounded rate.
    const context = { ip: '198.51.100.7', userAgent: 'vitest', requestId: 'req-issue' }
    for (let index = 0; index < 60; index += 1) {
      expect(() => captchaService.issue('register', context)).not.toThrow()
    }
    expect(() => captchaService.issue('register', context)).toThrowError(
      expect.objectContaining({ code: 'rate_limited' }),
    )
  })
})

describe('login escalation', () => {
  const loginInput = (identifier = 'owner@example.com') => ({
    identifier,
    password: 'wrong-password-1',
    client: 'web' as const,
    device: DEVICE,
    ip: CONTEXT.ip,
    userAgent: CONTEXT.userAgent,
    requestId: 'req-login',
  })

  it('demands a challenge after the configured failures, then accepts a solved one (AC-09b)', async () => {
    for (let index = 0; index < 3; index += 1) {
      await authService.login(loginInput()).catch(() => null)
    }
    await expect(authService.login(loginInput())).rejects.toMatchObject({
      code: 'captcha_required',
    })

    // Correct password + a solved challenge signs in.
    const solved = await authService.login({
      ...loginInput(),
      password: 'owner-password-123',
      ...issueCaptcha('login'),
    })
    expect(solved.user.email).toBe('owner@example.com')
  })

  it('keeps the two escalation dimensions isolated (AC-09c / RV-8)', async () => {
    // Two callers sharing the untrusted `0.0.0.0` address but presenting different
    // user agents must not share a failure budget: bucketing them together would
    // let one host demand a puzzle from the entire site (review R-V4-03).
    const sharedIp = '0.0.0.0'
    const keyA = captchaService.rateKeyFor(sharedIp, 'agent-a')
    const keyB = captchaService.rateKeyFor(sharedIp, 'agent-b')
    expect(keyA).not.toBe(keyB)
    // A trustworthy address is its own key — forensics keep the real value.
    expect(captchaService.rateKeyFor('203.0.113.9', 'agent-a')).toBe('203.0.113.9')

    // Three failures from agent A must not push agent B over the threshold.
    settingsService.patch({ 'captcha.requiredOnLoginAfterFailures': 3 }, ownerId())
    for (let index = 0; index < 3; index += 1) {
      await authService
        .login({ ...loginInput('nobody-a@example.com'), ip: sharedIp, userAgent: 'agent-a' })
        .catch(() => null)
    }
    expect(
      loginAttemptsRepo.countFailuresByIpSince(getDb(), keyA, Date.now() - 15 * 60 * 1000),
    ).toBeGreaterThanOrEqual(3)
    expect(
      loginAttemptsRepo.countFailuresByIpSince(getDb(), keyB, Date.now() - 15 * 60 * 1000),
    ).toBe(0)
    expect(captchaService.loginRequiresCaptcha('owner@example.com', sharedIp, 'agent-b')).toBe(false)
    expect(captchaService.loginRequiresCaptcha('owner@example.com', sharedIp, 'agent-a')).toBe(true)
  })

  it('answers the lockout rather than another puzzle once the account is locked', async () => {
    // The escalation threshold (3) sits below the lockout threshold (5). Once the
    // account is locked the lockout is the decided answer: making the user solve a
    // puzzle first would waste the image and hide the real reason.
    settingsService.patch({ 'security.loginMaxAttempts': 3 }, ownerId())
    for (let index = 0; index < 3; index += 1) {
      await authService
        .login({ ...loginInput(), ...issueCaptcha('login') })
        .catch(() => null)
    }
    await expect(
      authService.login({ ...loginInput(), password: 'owner-password-123' }),
    ).rejects.toMatchObject({ code: 'account_locked' })
  })
})

function ownerId(): string {
  const row = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  return row?.id ?? ''
}
