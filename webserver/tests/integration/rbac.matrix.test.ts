import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as userService from '@/server/services/userService'
import * as authService from '@/server/services/authService'
import * as roleService from '@/server/services/roleService'
import type { AuditContext } from '@/server/services/auditService'

import { POST as createUser } from '@/app/api/v1/admin/users/route'
import { PATCH as patchUser, DELETE as deleteUser } from '@/app/api/v1/admin/users/[id]/route'
import { POST as resetUserPassword } from '@/app/api/v1/admin/users/[id]/password-reset/route'
import { PUT as replacePermissions } from '@/app/api/v1/admin/roles/[id]/permissions/route'
import { POST as createInvite } from '@/app/api/v1/admin/invites/route'
import { PATCH as patchSettings } from '@/app/api/v1/admin/settings/route'
import { DELETE as revokeAdminSession } from '@/app/api/v1/admin/sessions/[id]/route'
import { GET as listAudit } from '@/app/api/v1/admin/audit/route'
import { PATCH as patchMe } from '@/app/api/v1/me/route'
import { DELETE as revokeMine } from '@/app/api/v1/me/sessions/[id]/route'

/**
 * RBAC matrix (spec §6.2).
 *
 * Table-driven over the four system roles × every write endpoint, asserting the
 * HTTP status the API promises. It calls the real route handlers rather than the
 * services, because the interesting failures — a missing `requirePermission`, a
 * CSRF check that also fires for Bearer callers, a permission checked after the
 * write — only exist at that layer.
 *
 * Bearer tokens are used on purpose: the desktop client authenticates that way,
 * and it keeps the suite free of cookie/CSRF plumbing it is not testing here.
 */

const ROLES = ['owner', 'admin', 'support', 'member'] as const
type RoleKey = (typeof ROLES)[number]

const ADMIN = 'http://127.0.0.1:8787'

/**
 * Passwords are sentences, not `role-123` shapes: the policy rejects a password
 * that contains the identifier, and a test that trips the policy asserts the
 * wrong thing (403 vs weak_password).
 */
const ROLE_PASSWORD: Record<RoleKey, string> = {
  owner: 'owner-password-123',
  admin: 'bright harbour lantern path',
  support: 'copper kettle window frame',
  member: 'quiet river stone meadow',
}
const MEMBER_PASSWORD = 'silent orchard morning tide'
const FOREIGN_PASSWORD = 'wandering glacier copper wire'

interface RouteParams {
  params: Promise<{ id: string }>
}

type PlainHandler = (request: Request) => Promise<Response>
type ParamHandler = (request: Request, context: RouteParams) => Promise<Response>

let harness: TestHarness
let actor: AuditContext
const tokens = new Map<RoleKey, string>()
let ipCounter = 1

function nextIp(): string {
  ipCounter += 1
  return `10.10.0.${ipCounter}`
}

function device(): { name: string; platform: string; appVersion: string } {
  return { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
}

async function signIn(identifier: string, password: string, requestId: string): Promise<string> {
  const result = await authService.login({
    identifier,
    password,
    client: 'desktop',
    device: device(),
    ip: nextIp(),
    userAgent: 'vitest',
    requestId,
  })
  return result.tokens.accessToken
}

/** Sign a role in once and reuse the token: the login limiter is per IP. */
async function tokenFor(role: RoleKey): Promise<string> {
  const cached = tokens.get(role)
  if (cached) return cached
  const identifier = role === 'owner' ? 'owner@example.com' : `${role}@example.com`
  const token = await signIn(identifier, ROLE_PASSWORD[role], `login-${role}`)
  tokens.set(role, token)
  return token
}

async function call(
  handler: PlainHandler,
  options: { method: string; path: string; token: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}` }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler(
    new Request(`${ADMIN}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  )
}

async function callWithId(
  handler: ParamHandler,
  options: { method: string; path: string; id: string; token: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}` }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler(
    new Request(`${ADMIN}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ id: options.id }) },
  )
}

/** A disposable member the endpoint under test may mutate. */
async function freshMember(label: string, password = MEMBER_PASSWORD): Promise<string> {
  const created = await userService.createUser(
    {
      email: `${label}@example.com`,
      username: label,
      password,
      status: 'active',
      planTag: 'free',
      note: '',
      mustChangePassword: false,
      roleKey: 'member',
    },
    actor,
  )
  return created.user.id
}

async function freshCustomRole(label: string): Promise<string> {
  return roleService.createRole(
    { key: `custom_${label}`, name: `Custom ${label}`, description: '', permissions: [] },
    actor,
  ).id
}

/** A live session owned by somebody else, for the revoke endpoints. */
async function freshForeignSession(label: string): Promise<string> {
  await freshMember(label, FOREIGN_PASSWORD)
  const result = await authService.login({
    identifier: `${label}@example.com`,
    password: FOREIGN_PASSWORD,
    client: 'desktop',
    device: device(),
    ip: nextIp(),
    userAgent: 'vitest',
    requestId: `session-${label}`,
  })
  return result.sessionId
}

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  tokens.clear()

  const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  if (!owner) throw new Error('seed owner missing')
  actor = {
    actorUserId: owner.id,
    actorLabel: owner.email,
    ip: '127.0.0.1',
    requestId: 'req-rbac',
  }

  for (const role of ['admin', 'support', 'member'] as const) {
    await userService.createUser(
      {
        email: `${role}@example.com`,
        username: role,
        password: ROLE_PASSWORD[role],
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: role,
      },
      actor,
    )
  }
})

afterEach(() => {
  harness.teardown()
})

describe('RBAC matrix — writes', () => {
  it('POST /admin/users answers 201 for owner and admin, 403 otherwise', async () => {
    const expected: Record<RoleKey, number> = { owner: 201, admin: 201, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await call(createUser, {
        method: 'POST',
        path: '/api/v1/admin/users',
        token,
        body: {
          email: `created_${role}@example.com`,
          username: `created_${role}`,
          status: 'active',
          planTag: 'free',
          mustChangePassword: true,
        },
      })
      expect(response.status, `${role} → POST /admin/users`).toBe(expected[role])
    }
  })

  it('PATCH /admin/users/{id} answers 200 for owner and admin, 403 otherwise', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 200, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const id = await freshMember(`patch_${role}`)
      const response = await callWithId(patchUser, {
        method: 'PATCH',
        path: `/api/v1/admin/users/${id}`,
        id,
        token,
        body: { displayName: `Renamed by ${role}` },
      })
      expect(response.status, `${role} → PATCH /admin/users/{id}`).toBe(expected[role])
    }
  })

  it('DELETE /admin/users/{id} answers 200 for owner and admin, 403 otherwise', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 200, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const id = await freshMember(`delete_${role}`)
      const response = await callWithId(deleteUser, {
        method: 'DELETE',
        path: `/api/v1/admin/users/${id}`,
        id,
        token,
      })
      expect(response.status, `${role} → DELETE /admin/users/{id}`).toBe(expected[role])
    }
  })

  it('POST /admin/users/{id}/password-reset answers 200 for owner and admin, 403 otherwise', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 200, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const id = await freshMember(`reset_${role}`)
      const response = await callWithId(resetUserPassword, {
        method: 'POST',
        path: `/api/v1/admin/users/${id}/password-reset`,
        id,
        token,
        body: { mode: 'temp_password' },
      })
      expect(response.status, `${role} → POST /admin/users/{id}/password-reset`).toBe(
        expected[role],
      )
    }
  })

  it('PUT /admin/roles/{id}/permissions is owner-only', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 403, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const roleId = await freshCustomRole(role)
      const response = await callWithId(replacePermissions, {
        method: 'PUT',
        path: `/api/v1/admin/roles/${roleId}/permissions`,
        id: roleId,
        token,
        body: { permissions: ['users.read'] },
      })
      expect(response.status, `${role} → PUT /admin/roles/{id}/permissions`).toBe(expected[role])
    }
  })

  it('POST /admin/invites answers 201 for owner and admin, 403 otherwise', async () => {
    const expected: Record<RoleKey, number> = { owner: 201, admin: 201, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await call(createInvite, {
        method: 'POST',
        path: '/api/v1/admin/invites',
        token,
        body: { maxUses: 1, expiresInDays: 7, roleKey: 'member' },
      })
      expect(response.status, `${role} → POST /admin/invites`).toBe(expected[role])
    }
  })

  it('PATCH /admin/settings is owner-only', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 403, support: 403, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await call(patchSettings, {
        method: 'PATCH',
        path: '/api/v1/admin/settings',
        token,
        body: { 'security.loginMaxAttempts': 5 },
      })
      expect(response.status, `${role} → PATCH /admin/settings`).toBe(expected[role])
    }
  })

  it('DELETE /admin/sessions/{id} works for owner, admin and support, 403 for member', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 200, support: 200, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      // Each attempt needs a live session: revoking one is the point of the route.
      const sessionId = await freshForeignSession(`victim_${role}`)
      const response = await callWithId(revokeAdminSession, {
        method: 'DELETE',
        path: `/api/v1/admin/sessions/${sessionId}`,
        id: sessionId,
        token,
      })
      expect(response.status, `${role} → DELETE /admin/sessions/{id}`).toBe(expected[role])
    }
  })
})

describe('RBAC matrix — reads and self-service', () => {
  it('GET /admin/audit answers 200 for owner, admin and support, 403 for member', async () => {
    const expected: Record<RoleKey, number> = { owner: 200, admin: 200, support: 200, member: 403 }
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await call(listAudit, {
        method: 'GET',
        path: '/api/v1/admin/audit',
        token,
      })
      expect(response.status, `${role} → GET /admin/audit`).toBe(expected[role])
    }
  })

  it('PATCH /me answers 200 for every role', async () => {
    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await call(patchMe, {
        method: 'PATCH',
        path: '/api/v1/me',
        token,
        body: { displayName: `${role} renamed` },
      })
      expect(response.status, `${role} → PATCH /me`).toBe(200)
    }
  })

  it('DELETE /me/sessions/{id} answers 404 for another user’s session for every role', async () => {
    // One foreign session, targeted four times: 404 must never become 403, which
    // would confirm that the id exists (spec AC-27).
    const sessionId = await freshForeignSession('foreign_user')

    for (const role of ROLES) {
      const token = await tokenFor(role)
      const response = await callWithId(revokeMine, {
        method: 'DELETE',
        path: `/api/v1/me/sessions/${sessionId}`,
        id: sessionId,
        token,
      })
      expect(response.status, `${role} → DELETE /me/sessions/{foreign}`).toBe(404)
    }
  })
})
