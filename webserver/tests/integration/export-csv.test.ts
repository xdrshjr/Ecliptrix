import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { resetAll } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import * as userService from '@/server/services/userService'
import { GET as usersExportRoute } from '@/app/api/v1/admin/users/export/route'
import type { AuditContext } from '@/server/services/auditService'

/**
 * CSV export.
 *
 * The BOM is not cosmetic: without it Excel reads a Chinese display name as
 * mojibake and the operator files a bug against the export rather than against
 * Excel. The column order is pinned because a downstream spreadsheet references
 * columns by position.
 */

const ADMIN = 'http://127.0.0.1:8787'
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }

let harness: TestHarness
let token: string
let actor: AuditContext

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const login = await authService.login({
    identifier: 'owner@example.com',
    password: 'owner-password-123',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'csv-owner-key' },
    ip: '10.4.4.4',
    userAgent: 'vitest',
    requestId: 'req-csv',
  })
  token = login.tokens.accessToken
  actor = { actorUserId: login.user.id, actorLabel: 'owner', ip: '1.1.1.1', requestId: 'req-csv' }
  await userService.createUser(
    {
      email: 'comma,name@example.com',
      username: 'comma',
      displayName: '张三, 测试',
      password: 'quiet river stone meadow',
      status: 'active',
      planTag: 'free',
      note: '',
      mustChangePassword: false,
    },
    actor,
  )
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

function request(query = ''): Request {
  return new Request(`${ADMIN}/api/v1/admin/users/export${query}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe('users csv export', () => {
  it('starts with a utf-8 BOM and keeps a stable column order', async () => {
    const response = await usersExportRoute(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    // `Response.text()` strips a leading BOM by spec, so the assertion has to look
    // at the bytes — which is also what Excel does.
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const text = await response.text()
    const header = text.replace(/^\uFEFF/, '').split('\r\n')[0]
    expect(header).toBe(
      'email,username,display_name,role,status,plan_tag,email_verified,created_at,last_login_at,active_sessions',
    )
  })

  it('quotes values that contain a comma or a quote', async () => {
    const text = (await (await usersExportRoute(request())).text()).replace(/^\uFEFF/, '')
    expect(text).toContain('"comma,name@example.com"')
    expect(text).toContain('"张三, 测试"')
  })

  it('respects the filters and writes an audit row', async () => {
    const response = await usersExportRoute(request('?query=comma'))
    const text = (await response.text()).replace(/^\uFEFF/, '')
    const lines = text.trim().split('\r\n')
    // Header + exactly one match.
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('comma')

    const { auditRepo } = await import('../setup/repos')
    const rows = auditRepo.list(
      (await import('@/server/db/client')).getDb(),
      { action: 'admin.users_exported' },
      { page: 1, pageSize: 5, offset: 0 },
    )
    expect(rows.total).toBeGreaterThan(0)
  })
})
