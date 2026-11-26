import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextResponse } from 'next/server'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as accountExportService from '@/server/services/accountExportService'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { GET as exportRoute } from '@/app/api/v1/me/export/route'
import type { AuditContext } from '@/server/services/auditService'

/**
 * Data export.
 *
 * Two halves: the document (no credential material, capped activity, masked IPs)
 * and the HTTP shape. The interesting one is the HTTP shape — the success body is
 * an attachment while every failure stays a JSON envelope, because a `429` that
 * arrives as a downloaded file is a bug nobody notices until a user reports it.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-export' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet river stone meadow'
const ADMIN = 'http://127.0.0.1:8787'

let harness: TestHarness
let actor: AuditContext
let userId: string
let token: string

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const result = await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'export-device-key-1' },
    ...CONTEXT,
    ...issueCaptcha(),
  })
  userId = result.user.id
  token = result.tokens.accessToken
  actor = { actorUserId: userId, actorLabel: 'member@example.com', ip: '127.0.0.1', requestId: 'req-e' }
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

function user() {
  const row = usersRepo.findById(getDb(), userId)
  if (!row) throw new Error('user vanished')
  return row
}

describe('account export', () => {
  it('contains six blocks and no credential material', () => {
    const document = accountExportService.build(user())
    expect(document.format).toBe('ecliptrix.account.export')
    expect(Object.keys(document)).toEqual(
      expect.arrayContaining([
        'account',
        'sessions',
        'activity',
        'invites',
        'deletion',
        'truncated',
      ]),
    )
    const serialised = JSON.stringify(document)
    expect(serialised).not.toMatch(/_hash/)
    expect(serialised).not.toMatch(/token_hash/i)
    expect(serialised).not.toContain(user().password_hash)
    // The device list masks the address it came from.
    expect(document.sessions[0]?.ipMasked).toMatch(/x\.x$/)
  })

  it('caps the activity block and flags truncation', () => {
    const db = getDb()
    const insert = db.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, actor_label, action, target_type, target_id, metadata, ip, request_id, created_at)
       VALUES (?, ?, 'test', 'auth.login', 'user', ?, '{}', '1.2.3.4', 'r', ?)`,
    )
    for (let index = 0; index < accountExportService.ACTIVITY_LIMIT + 5; index += 1) {
      insert.run(`a-${index}`, userId, userId, Date.now() - index * 1000)
    }
    const document = accountExportService.build(user())
    expect(document.activity).toHaveLength(accountExportService.ACTIVITY_LIMIT)
    expect(document.truncated.activity).toBe(true)
  })

  it('drives the cooldown from users.last_exported_at, not from the audit log', () => {
    expect(accountExportService.cooldown(user()).allowed).toBe(true)
    accountExportService.exportFor(user(), actor)
    const after = user()
    expect(after.last_exported_at).not.toBeNull()
    expect(accountExportService.cooldown(after).allowed).toBe(false)
    // Deleting every audit row must NOT re-open the cooldown: that is the point of
    // keeping the timestamp on the user row.
    getDb().prepare('DELETE FROM audit_events').run()
    expect(accountExportService.cooldown(user()).allowed).toBe(false)
  })

  it('writes a user.exported audit row with counts only', () => {
    accountExportService.exportFor(user(), actor)
    const rows = auditRepo.list(getDb(), { action: 'user.exported' }, { page: 1, pageSize: 5, offset: 0 })
    expect(rows.total).toBe(1)
    const metadata = JSON.parse(rows.rows[0]?.metadata ?? '{}') as Record<string, unknown>
    expect(metadata).toHaveProperty('activityRows')
    expect(metadata).not.toHaveProperty('email')
  })

  it('answers the attachment headers on success', async () => {
    const response = await exportRoute(
      new Request(`${ADMIN}/api/v1/me/export`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="ecliptrix-account-/)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    const body = JSON.parse(await response.text()) as { format: string }
    expect(body.format).toBe('ecliptrix.account.export')
  })

  it('answers a 429 as a json envelope, not as a second attachment', async () => {
    const first = await exportRoute(
      new Request(`${ADMIN}/api/v1/me/export`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(first.status).toBe(200)

    const second = await exportRoute(
      new Request(`${ADMIN}/api/v1/me/export`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(second.status).toBe(429)
    expect(second.headers.get('content-type')).toContain('application/json')
    expect(second.headers.get('content-disposition')).toBeNull()
    const body = JSON.parse(await second.text()) as {
      error_code: string
      error_details?: { retryAfterSeconds?: number }
    }
    expect(body.error_code).toBe('rate_limited')
    expect(body.error_details?.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('export document shape', () => {
  it('is plain JSON serialisable with an ISO timestamp', () => {
    const document = accountExportService.build(user())
    expect(() => JSON.stringify(document)).not.toThrow()
    expect(document.account.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(NextResponse).toBeTypeOf('function')
  })
})
