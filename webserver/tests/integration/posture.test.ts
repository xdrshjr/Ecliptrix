import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo, rolesRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as userService from '@/server/services/userService'
import * as settingsService from '@/server/services/settingsService'
import * as postureService from '@/server/services/securityPostureService'
import { SYSTEM_ROLE_PERMISSIONS } from '@/server/auth/permissions'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'
import { GET as getSecurity } from '@/app/api/v1/admin/security/route'

/**
 * Root administrator identity, bootstrap-credential detection, and the posture
 * panel's access boundary (AC-10, AC-11, AC-33).
 *
 * The posture panel is where an operator learns that the highest-privilege account
 * is still on the password that shipped in `.env`. Two things therefore have to be
 * true, and both are pinned here rather than assumed:
 *
 *  - the detection must flip when — and only when — the password actually changes,
 *    because a stale "still on bootstrap" badge trains people to ignore it;
 *  - the panel must not be readable by anybody who lacks `security.read`, since its
 *    payload names the root account and the escalation attempts against it.
 */

const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const ADMIN = 'http://127.0.0.1:8787'
const MEMBER_PASSWORD = 'quiet river stone meadow'
const ADMIN_PASSWORD = 'bright harbour lantern path'

let harness: TestHarness

beforeEach(async () => {
  // The shipped default is `xdrshjr` (requirement A-2). The shared harness pins
  // `owner` for historical fixtures, so this case states the default explicitly
  // instead of inheriting a value that would make the assertion vacuous.
  harness = await createHarness({ ROOT_ADMIN_USERNAME: 'xdrshjr' })
  resetAll()
})

afterEach(() => {
  harness.teardown()
})

function ownerRow(): UserRow {
  const row = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'xdrshjr')
  if (!row) throw new Error('seeded root administrator missing')
  return row
}

function ownerActor(row: UserRow): AuditContext {
  return { actorUserId: row.id, actorLabel: row.email, ip: '127.0.0.1', requestId: 'req-posture' }
}

async function signIn(identifier: string, password: string, requestId: string): Promise<string> {
  const result = await authService.login({
    identifier,
    password,
    client: 'desktop',
    device: DEVICE,
    ip: `10.40.0.${Math.floor(Math.random() * 200) + 1}`,
    userAgent: 'vitest',
    requestId,
  })
  return result.tokens.accessToken
}

describe('root administrator', () => {
  it('seeds xdrshjr with the owner role and the wildcard permission (AC-10)', () => {
    const owner = ownerRow()
    expect(owner.username_normalized).toBe('xdrshjr')
    const role = rolesRepo.findById(getDb(), owner.role_id)
    expect(role?.key).toBe('owner')
    expect(rolesRepo.permissionsFor(getDb(), owner.role_id)).toEqual(
      [...SYSTEM_ROLE_PERMISSIONS.owner],
    )
    // The ledger pair stays NULL: the seed is "created by the system", which is a
    // different statement from "an operator promoted this account".
    expect(owner.role_granted_by).toBeNull()
  })

  it('reports the bootstrap credential until the password actually changes (AC-11)', async () => {
    const owner = ownerRow()
    expect(owner.password_updated_at).toBeLessThanOrEqual(owner.created_at)
    expect(postureService.posture().rootAdmin?.bootstrapPassword).toBe(true)

    const login = await authService.login({
      identifier: 'owner@example.com',
      password: 'owner-password-123',
      client: 'desktop',
      device: DEVICE,
      ip: '10.41.0.1',
      userAgent: 'vitest',
      requestId: 'req-rotate',
    })
    await authService.changePassword({
      userId: owner.id,
      currentPassword: 'owner-password-123',
      newPassword: 'a-brand-new-long-passphrase',
      signOutOtherSessions: false,
      currentSessionId: login.sessionId,
      requestId: 'req-rotate-2',
      ip: '10.41.0.1',
    })

    expect(postureService.posture().rootAdmin?.bootstrapPassword).toBe(false)
  })

  it('masks the root address in the payload instead of returning it verbatim', () => {
    const root = postureService.posture().rootAdmin
    expect(root?.email).toContain('***')
    expect(root?.email).not.toBe('owner@example.com')
  })
})

describe('posture panel access', () => {
  it('answers 200 for an administrator and 403 for a member (AC-33)', async () => {
    const owner = ownerRow()
    await userService.createUser(
      {
        email: 'admin@example.com',
        username: 'admin',
        password: ADMIN_PASSWORD,
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      ownerActor(owner),
    )
    await authService.register({
      email: 'member@example.com',
      password: MEMBER_PASSWORD,
      username: 'member',
      client: 'web',
      device: DEVICE,
      ip: '10.42.0.1',
      userAgent: 'vitest',
      requestId: 'req-member',
      ...issueCaptcha(),
    })

    const adminToken = await signIn('admin@example.com', ADMIN_PASSWORD, 'login-admin')
    const memberToken = await signIn('member@example.com', MEMBER_PASSWORD, 'login-member')

    const adminResponse = await getSecurity(
      new Request(`${ADMIN}/api/v1/admin/security`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    )
    expect(adminResponse.status).toBe(200)
    const body = (await adminResponse.json()) as {
      data: { rootAdmin: { bootstrapPassword: boolean }; captcha: { loginThreshold: number } }
    }
    expect(body.data.rootAdmin.bootstrapPassword).toBe(true)
    // The card shows the value the gate is using, not a hard-coded constant.
    expect(body.data.captcha.loginThreshold).toBe(
      settingsService.getNumber('captcha.requiredOnLoginAfterFailures'),
    )

    const memberResponse = await getSecurity(
      new Request(`${ADMIN}/api/v1/admin/security`, {
        headers: { authorization: `Bearer ${memberToken}` },
      }),
    )
    expect(memberResponse.status).toBe(403)
  })
})
