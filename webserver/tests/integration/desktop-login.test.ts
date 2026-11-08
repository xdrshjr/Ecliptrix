import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import * as authService from '@/server/services/authService'
import * as sessionService from '@/server/services/sessionService'
import * as settingsService from '@/server/services/settingsService'
import { requireSession } from '@/server/auth/guards'
import { buildRequestContext } from '@/server/http/requestContext'
import { toSessionDto } from '@/server/db/types'
import { resetAll } from '@/server/auth/rateLimit'
import { sessionsRepo, usersRepo } from '../setup/repos'

import { POST as loginRoute } from '@/app/api/v1/auth/login/route'
import { POST as registerRoute } from '@/app/api/v1/auth/register/route'

/**
 * The desktop login gate, end to end at the service layer.
 *
 * Everything here runs against a real migrated SQLite file: the device-replacement
 * transaction, the partial index behind it and the lockout counters are exactly the
 * parts a mock would hide. The heartbeat is emulated by calling the same guard the
 * route calls (`requireSession` with `allowPasswordChangeRequired`), so a `401
 * session_revoked` here means a `401 session_revoked` on the wire.
 */

/**
 * `create()` can be told to fail once, which is how the atomicity case proves the
 * old session survives a half-done replacement. The rest of the repository is the
 * real thing — only the one write is intercepted.
 */
const failNextCreate = vi.hoisted(() => ({ enabled: false }))

vi.mock('@/server/db/repositories/sessionsRepo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/db/repositories/sessionsRepo')>()
  return {
    ...actual,
    create: (...args: Parameters<typeof actual.create>) => {
      if (failNextCreate.enabled) {
        failNextCreate.enabled = false
        throw new Error('injected session insert failure')
      }
      return actual.create(...args)
    },
  }
})

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-desktop' }
const OWNER_EMAIL = 'owner@example.com'
const OWNER_PASSWORD = 'owner-password-123'
const DEVICE_KEY = 'devicekeyaaaa1111'

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  failNextCreate.enabled = false
  resetAll()
})

afterEach(() => {
  harness.teardown()
})

function desktopLogin(deviceKey = DEVICE_KEY, clientVersion = '1.0.1') {
  return authService.login({
    identifier: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    client: 'desktop',
    clientVersion,
    device: { name: 'Workstation', platform: 'win32-x64', appVersion: clientVersion, deviceKey },
    ...CONTEXT,
  })
}

/** Whatever the heartbeat route would answer for this access token. */
function heartbeat(token: string) {
  const request = new Request('http://127.0.0.1:8787/api/v1/auth/heartbeat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '127.0.0.1' },
  })
  return requireSession(request, buildRequestContext(request), { allowPasswordChangeRequired: true })
}

function ownerId(): string {
  return usersRepo.findByEmailOrUsername(getDb(), OWNER_EMAIL, 'owner')?.id ?? ''
}

function setSettings(values: Record<string, unknown>): void {
  settingsService.patch(values, ownerId())
}

describe('same-device replacement', () => {
  it('revokes the previous session of the same deviceKey on re-login', async () => {
    const first = await desktopLogin()
    expect(heartbeat(first.tokens.accessToken).session.id).toBe(first.sessionId)

    const second = await desktopLogin()
    expect(second.sessionId).not.toBe(first.sessionId)

    const revoked = sessionService.sessionFromId(first.sessionId)
    expect(revoked?.revoked_at).not.toBeNull()
    expect(revoked?.revoked_reason).toBe('same_device_relogin')

    // The old access token now answers what the heartbeat route would answer.
    expect(() => heartbeat(first.tokens.accessToken)).toThrowError(
      expect.objectContaining({ code: 'session_revoked' }),
    )
    expect(heartbeat(second.tokens.accessToken).session.id).toBe(second.sessionId)
  })

  it('leaves sessions of other devices alone', async () => {
    const laptop = await desktopLogin('devicekeylaptop22')
    const desktop = await desktopLogin('devicekeydesk333')

    expect(heartbeat(laptop.tokens.accessToken).session.id).toBe(laptop.sessionId)
    expect(heartbeat(desktop.tokens.accessToken).session.id).toBe(desktop.sessionId)
  })

  it('keeps the old browser behaviour when no deviceKey is sent', async () => {
    const webLogin = () =>
      authService.login({
        identifier: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        client: 'web',
        device: { name: '', platform: '', appVersion: '' },
        ...CONTEXT,
      })

    const first = await webLogin()
    const second = await webLogin()

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(heartbeat(first.tokens.accessToken).session.id).toBe(first.sessionId)
    expect(sessionService.sessionFromId(first.sessionId)?.device_key).toBe('')
  })

  it('audits a replacement with the device key and the count', async () => {
    await desktopLogin()
    const second = await desktopLogin()

    const rows = getDb()
      .prepare("SELECT metadata FROM audit_events WHERE action = 'auth.session_relogin'")
      .all() as { metadata: string }[]
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]?.metadata ?? '{}')).toEqual({
      deviceKey: DEVICE_KEY,
      replacedCount: 1,
    })
    expect(second.sessionId).toBeTruthy()
  })

  it('rolls the replacement back when the insert fails (old session stays valid)', async () => {
    const first = await desktopLogin()

    failNextCreate.enabled = true
    expect(() =>
      sessionService.replaceDeviceSession({
        userId: ownerId(),
        client: 'desktop',
        deviceKey: DEVICE_KEY,
        ip: CONTEXT.ip,
        userAgent: CONTEXT.userAgent,
      }),
    ).toThrowError('injected session insert failure')

    // Only the insert failed, not the revocation: the transaction rolled back.
    const original = sessionService.sessionFromId(first.sessionId)
    expect(original?.revoked_at).toBeNull()
    expect(heartbeat(first.tokens.accessToken).session.id).toBe(first.sessionId)
    expect(sessionsRepo.countActiveForUser(getDb(), ownerId(), Date.now())).toBe(1)
  })
})

describe('version gate', () => {
  it('refuses an outdated desktop client with 426 and the version to reach', async () => {
    setSettings({ 'client.minVersion': '1.4.0' })

    const error = await desktopLogin(DEVICE_KEY, '1.3.9').catch(
      (thrown: { code: string; status: number; details?: unknown }) => thrown,
    )
    expect(error).toMatchObject({
      code: 'client_outdated',
      status: 426,
      details: { minVersion: '1.4.0' },
    })
  })

  it('compares numerically, not lexicographically', async () => {
    setSettings({ 'client.minVersion': '1.0.10' })

    // Lexicographic comparison would call "1.0.9" the newer string.
    await expect(desktopLogin(DEVICE_KEY, '1.0.9')).rejects.toMatchObject({
      code: 'client_outdated',
    })
    await expect(desktopLogin(DEVICE_KEY, '1.0.10')).resolves.toBeTruthy()
  })

  it('does not gate anything while the minimum is empty', async () => {
    setSettings({ 'client.minVersion': '' })
    await expect(desktopLogin(DEVICE_KEY, '0.0.1')).resolves.toBeTruthy()
  })

  it('ignores the gate for browser clients and for clients without a version', async () => {
    setSettings({ 'client.minVersion': '99.0.0' })

    await expect(
      authService.login({
        identifier: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        client: 'web',
        device: { name: '', platform: '', appVersion: '' },
        ...CONTEXT,
      }),
    ).resolves.toBeTruthy()

    await expect(
      authService.login({
        identifier: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        client: 'desktop',
        device: { name: 'Old build', platform: 'win32', appVersion: '' },
        ...CONTEXT,
      }),
    ).resolves.toBeTruthy()
  })

  it('never touches heartbeat or refresh', async () => {
    const issued = await desktopLogin()
    setSettings({ 'client.minVersion': '99.0.0' })

    // Heartbeat keeps working for the session that already exists.
    expect(heartbeat(issued.tokens.accessToken).session.id).toBe(issued.sessionId)

    // Refresh posts the token in the body (desktop carrier), so no CSRF applies.
    const rotated = sessionService.rotateRefreshToken(issued.tokens.refreshToken, {
      ip: CONTEXT.ip,
      userAgent: CONTEXT.userAgent,
    })
    expect(rotated).not.toBeNull()
    expect(rotated).not.toBe('reuse-detected')
    if (rotated && rotated !== 'reuse-detected') {
      expect(heartbeat(rotated.accessToken).session.id).toBe(issued.sessionId)
    }
  })

  it('records the refusal without spending a login attempt or locking the account', async () => {
    setSettings({ 'client.minVersion': '2.0.0', 'security.loginMaxAttempts': 3 })

    for (let index = 0; index < 6; index += 1) {
      await desktopLogin(DEVICE_KEY, '1.0.0').catch(() => null)
    }

    const attempts = getDb()
      .prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE success = 0')
      .get() as { count: number }
    expect(attempts.count).toBe(0)
    expect(usersRepo.findById(getDb(), ownerId())?.failed_login_count).toBe(0)

    // A correct password still gets in — with the gate lifted.
    setSettings({ 'client.minVersion': '' })
    await expect(desktopLogin()).resolves.toBeTruthy()

    const blocked = getDb()
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auth.login_blocked_outdated_client'")
      .get() as { count: number }
    expect(blocked.count).toBe(6)
  })
})

describe('maintenance mode', () => {
  it('answers 503 with details.reason=maintenance and keeps existing sessions alive', async () => {
    const issued = await desktopLogin()
    setSettings({ 'app.maintenanceMessage': '今晚 23:00 数据库维护' })

    const error = await desktopLogin('devicekeyother444').catch(
      (thrown: { code: string; status: number; details?: unknown; message: string }) => thrown,
    )
    expect(error).toMatchObject({
      code: 'service_unavailable',
      status: 503,
      details: { reason: 'maintenance' },
      message: '今晚 23:00 数据库维护',
    })

    // Section 2.13 of the desktop spec: maintenance is not a lockout.
    expect(heartbeat(issued.tokens.accessToken).session.id).toBe(issued.sessionId)

    setSettings({ 'app.maintenanceMessage': '' })
    await expect(desktopLogin('devicekeyother444')).resolves.toBeTruthy()
  })

  it('blocks registration too, and audits both endpoints', async () => {
    setSettings({ 'app.maintenanceMessage': '维护中' })

    await expect(desktopLogin()).rejects.toMatchObject({ code: 'service_unavailable' })
    await expect(
      authService.register({
        email: 'newcomer@example.com',
        password: 'quiet meadow lantern drift',
        client: 'desktop',
        clientVersion: '1.0.1',
        device: { name: 'dev', platform: 'win32-x64', appVersion: '1.0.1', deviceKey: DEVICE_KEY },
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'service_unavailable' })

    const rows = getDb()
      .prepare("SELECT metadata FROM audit_events WHERE action = 'auth.login_blocked_maintenance'")
      .all() as { metadata: string }[]
    const sources = rows.map((row) => JSON.parse(row.metadata).source)
    expect(sources).toContain('login')
    expect(sources).toContain('register')
  })
})

describe('session listing and cap', () => {
  it('marks exactly one session as current, and it is the caller’s', async () => {
    const issued = await desktopLogin()
    await desktopLogin('devicekeysecond22')

    const rows = sessionService.listForUser(ownerId())
    const dtos = rows.map((row) => toSessionDto(row, issued.sessionId))

    expect(dtos.filter((dto) => dto.current)).toHaveLength(1)
    expect(dtos.find((dto) => dto.current)?.id).toBe(issued.sessionId)
    expect(dtos.every((dto) => typeof dto.deviceKey === 'string')).toBe(true)
    expect(dtos.filter((dto) => dto.deviceKey !== '').length).toBeGreaterThanOrEqual(2)
  })

  it('applies security.maxActiveSessions, evicting the least recently used', async () => {
    setSettings({ 'security.maxActiveSessions': 3 })
    const base = Date.now()

    const issued = []
    for (let index = 0; index < 4; index += 1) {
      const session = await desktopLogin(`devicekeyslot${index}0000`)
      // Deterministic LRU order: the cap decides on `last_seen_at`, and four
      // logins inside one millisecond would otherwise tie.
      getDb()
        .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .run(base + index * 1000, session.sessionId)
      issued.push(session)
    }

    expect(sessionsRepo.countActiveForUser(getDb(), ownerId(), Date.now())).toBe(3)
    const evicted = sessionService.sessionFromId(issued[0]?.sessionId ?? '')
    expect(evicted?.revoked_reason).toBe('session_limit')
    for (const survivor of issued.slice(1)) {
      expect(sessionService.sessionFromId(survivor.sessionId)?.revoked_at).toBeNull()
    }
  })
})

describe('desktop login/register payload parity', () => {
  /**
   * Both endpoints issue a desktop session, and the main process feeds both
   * through the same `sessionFromLogin()` (desktop/main/authController.js). A
   * field that only login returns therefore becomes a silently degraded
   * `auth-session.json` after a sign-up — `refreshExpiresAt` was missing here,
   * which un-bounded the offline grace window (D2-08).
   */
  const post = (path: string, body: unknown) =>
    new Request(`http://127.0.0.1:8787${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify(body),
    })

  it('register 201 answers the same desktop keys as login 200', async () => {
    const loginResponse = await loginRoute(
      post('/api/v1/auth/login', {
        identifier: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        client: 'desktop',
        clientVersion: '1.0.1',
        device: { name: 'Workstation', platform: 'win32-x64', appVersion: '1.0.1', deviceKey: DEVICE_KEY },
      }),
    )
    expect(loginResponse.status).toBe(200)
    const login = (await loginResponse.json()) as { data: Record<string, unknown> }

    const registerResponse = await registerRoute(
      post('/api/v1/auth/register', {
        email: 'newcomer@example.com',
        username: 'newcomer',
        password: 'quiet meadow lantern drift',
        client: 'desktop',
        clientVersion: '1.0.1',
        device: { name: 'Workstation', platform: 'win32-x64', appVersion: '1.0.1', deviceKey: DEVICE_KEY },
      }),
    )
    expect(registerResponse.status).toBe(201)
    const registered = (await registerResponse.json()) as { data: Record<string, unknown> }

    expect(Object.keys(registered.data).sort()).toEqual(Object.keys(login.data).sort())
    expect(Object.keys(registered.data.user as object).sort()).toEqual(
      Object.keys(login.data.user as object).sort(),
    )
    // A real ISO timestamp, not the epoch-0 fallback the gate stores as null.
    expect(Date.parse(String(registered.data.refreshExpiresAt))).toBeGreaterThan(Date.now())
    expect(registered.data.accessToken).toBeTypeOf('string')
    expect(registered.data.refreshToken).toBeTypeOf('string')
  })
})
