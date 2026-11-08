import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as adminSessionService from '@/server/services/adminSessionService'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { REVOKE_REASON } from '@/server/auth/constants'
import { POST as revokeRoute } from '@/app/api/v1/admin/sessions/revoke/route'

/**
 * Global session administration.
 *
 * Two properties matter: the list must not become a bulk personal-data export
 * (masked address + masked IP), and a bulk action must write ONE audit row — a
 * single click that writes 100 rows makes the log useless for the investigation it
 * exists for.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-sessions' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PAGE = { page: 1, pageSize: 20, offset: 0 }
const ADMIN = 'http://127.0.0.1:8787'

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  // One desktop and one web session for a member, plus the owner's session.
  await authService.register({
    email: 'member@example.com',
    password: 'quiet river stone meadow',
    username: 'member',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'sessions-device-key' },
    ...CONTEXT,
  })
  await authService.login({
    identifier: 'member@example.com',
    password: 'quiet river stone meadow',
    client: 'web',
    device: DEVICE,
    ip: '10.9.9.9',
    userAgent: 'Mozilla/5.0',
    requestId: 'req-web',
  })
  await authService.login({
    identifier: 'owner@example.com',
    password: 'owner-password-123',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'owner-session-key' },
    ip: '10.8.8.8',
    userAgent: 'vitest',
    requestId: 'req-owner',
  })
})

afterEach(() => {
  harness.teardown()
})

describe('admin sessions', () => {
  it('filters by client, platform and activeOnly', () => {
    const all = adminSessionService.listAll({
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    })
    expect(all.total).toBe(3)

    const desktop = adminSessionService.listAll({
      client: 'desktop',
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    })
    expect(desktop.total).toBe(2)
    expect(desktop.rows.every((row) => row.client === 'desktop')).toBe(true)

    const web = adminSessionService.listAll({
      client: 'web',
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    })
    expect(web.total).toBe(1)

    const noPlatform = adminSessionService.listAll({
      platform: 'linux',
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    })
    expect(noPlatform.total).toBe(0)

    const active = adminSessionService.listAll({
      activeOnly: true,
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    })
    expect(active.total).toBe(3)
  })

  it('masks the address and the ip in the list', () => {
    const rows = adminSessionService.listAll({
      sort: { column: 'last_seen_at', direction: 'DESC' },
      page: PAGE,
    }).rows
    for (const row of rows) {
      expect(row.userEmail).toContain('***')
      expect(row.userEmail).not.toContain('member@example.com')
      expect(row.ip).toMatch(/x\.x$/)
    }
  })

  it('revokes up to 100 sessions and reports the skips', () => {
    const ids = adminSessionService
      .listAll({ sort: { column: 'last_seen_at', direction: 'DESC' }, page: PAGE })
      .rows.map((row) => row.id)
    const result = adminSessionService.revokeMany([...ids, 'does-not-exist'], 'admin_revoke')
    expect(result.revoked).toBe(3)
    // The unknown id is skipped, not an error: a stale row must not fail the batch.
    expect(result.skipped).toBe(1)
    expect(result.reason).toBe(REVOKE_REASON.adminRevoked)
  })

  it('writes one aggregated audit row for the whole batch', async () => {
    const ids = adminSessionService
      .listAll({ sort: { column: 'last_seen_at', direction: 'DESC' }, page: PAGE })
      .rows.slice(0, 2)
      .map((row) => row.id)
    // Through the route, because the aggregation lives there: the service revokes,
    // the route records one row for the batch.
    const login = await authService.login({
      identifier: 'owner@example.com',
      password: 'owner-password-123',
      client: 'desktop',
      device: { ...DEVICE, deviceKey: 'owner-session-key' },
      ip: '10.7.7.7',
      userAgent: 'vitest',
      requestId: 'req-bulk',
    })
    const response = await revokeRoute(
      new Request(`${ADMIN}/api/v1/admin/sessions/revoke`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${login.tokens.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids, reason: 'security_incident' }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { revoked: number; skipped: number } }
    expect(body.data.revoked).toBeGreaterThan(0)

    const rows = auditRepo.list(
      getDb(),
      { action: 'admin.sessions_revoked' },
      { page: 1, pageSize: 10, offset: 0 },
    )
    expect(rows.total).toBe(1)
    const metadata = JSON.parse(rows.rows[0]?.metadata ?? '{}') as Record<string, unknown>
    expect(metadata.reason).toBe('security_incident')
    expect(metadata.count).toBe(body.data.revoked)
  })

  it('falls back to the default reason for an unknown one', () => {
    const ids = adminSessionService
      .listAll({ sort: { column: 'last_seen_at', direction: 'DESC' }, page: PAGE })
      .rows.slice(0, 1)
      .map((row) => row.id)
    expect(adminSessionService.revokeMany(ids, 'not-a-reason').reason).toBe(
      REVOKE_REASON.adminRevoked,
    )
    // And the stored value is the whitelisted one, not the caller's string.
    const rows = sessionsRepo.listAll(
      getDb(),
      { sort: { column: 'last_seen_at', direction: 'DESC' }, page: PAGE },
      Date.now(),
    ).rows
    expect(rows.some((row) => row.revoked_reason === 'not-a-reason')).toBe(false)
    expect(usersRepo.countAll(getDb())).toBeGreaterThan(0)
  })
})
