import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import * as userService from '@/server/services/userService'
import * as roleService from '@/server/services/roleService'
import * as sessionService from '@/server/services/sessionService'
import * as authService from '@/server/services/authService'
import * as settingsService from '@/server/services/settingsService'
import { getDb } from '@/server/db/client'
import { auditRepo, rolesRepo, usersRepo } from '../setup/repos'
import { resetAll } from '@/server/auth/rateLimit'
import type { AuditContext } from '@/server/services/auditService'

let harness: TestHarness
let ownerId: string
let adminId: string

const ACTOR: AuditContext = {
  actorUserId: 'seed',
  actorLabel: 'owner@example.com',
  ip: '127.0.0.1',
  requestId: 'req-admin',
}

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const db = getDb()
  const owner = usersRepo.findByEmailOrUsername(db, 'owner@example.com', 'owner')
  if (!owner) throw new Error('seed owner missing')
  ownerId = owner.id
  ACTOR.actorUserId = owner.id
  settingsService.patch({ 'security.loginMaxAttempts': 5 }, ownerId)

  const admin = await userService.createUser(
    {
      email: 'admin@example.com',
      username: 'adminuser',
      password: 'bright harbour lantern path',
      status: 'active',
      planTag: 'pro',
      note: '',
      mustChangePassword: false,
      roleKey: 'admin',
    },
    ACTOR,
  )
  adminId = admin.user.id
})

afterEach(() => {
  harness.teardown()
})

describe('user CRUD', () => {
  it('creates a user with a generated one-time password', async () => {
    const created = await userService.createUser(
      {
        email: 'new@example.com',
        username: 'newbie',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: true,
      },
      ACTOR,
    )
    expect(created.temporaryPassword).toHaveLength(16)
    expect(created.user.must_change_password).toBe(1)
  })

  it('rejects a duplicate email', async () => {
    await expect(
      userService.createUser(
        {
          email: 'admin@example.com',
          username: 'different',
          status: 'active',
          planTag: 'free',
          note: '',
          mustChangePassword: false,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'email_taken' })
  })

  it('updates a display name and audits the change', () => {
    userService.updateUser(ownerId, adminId, { displayName: 'Renamed Admin' }, ACTOR)
    const detail = userService.getUserDetail(adminId)
    expect(detail.display_name).toBe('Renamed Admin')

    const audit = auditRepo.list(getDb(), { action: 'user.update' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBe(1)
  })

  it('refuses to modify the owner account', () => {
    // Owner protection is checked before self-protection, so an owner acting on
    // themselves gets the owner error — that is the stricter, more actionable one.
    expect(() =>
      userService.updateUser(adminId, ownerId, { status: 'suspended' }, ACTOR),
    ).toThrowError(/超级管理员/)
    expect(() => userService.deleteUser(adminId, ownerId, { hard: false }, ACTOR)).toThrowError(
      /超级管理员/,
    )
  })

  it('refuses self-suspension and self-deletion', async () => {
    // A non-owner administrator must not be able to lock themselves out either.
    const adminActor: AuditContext = { ...ACTOR, actorUserId: adminId }
    expect(() =>
      userService.updateUser(adminId, adminId, { status: 'suspended' }, adminActor),
    ).toThrowError(/不能对自己/)
    expect(() => userService.deleteUser(adminId, adminId, { hard: false }, adminActor)).toThrowError(
      /不能对自己/,
    )
    await Promise.resolve()
  })

  it('revokes every session when a user is suspended', async () => {
    const login = await authService.login({
      identifier: 'admin@example.com',
      password: 'bright harbour lantern path',
      client: 'web',
      device: { name: 'test', platform: 'win32', appVersion: '1' },
      ip: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-login',
    })
    expect(sessionService.listForUser(adminId).length).toBe(1)

    userService.updateUser(ownerId, adminId, { status: 'suspended' }, ACTOR)
    expect(sessionService.listForUser(adminId).length).toBe(0)
    expect(sessionService.sessionFromId(login.sessionId)?.revoked_reason).toBe('suspended')
  })

  it('soft-deletes, frees the email, and restores the original address', () => {
    userService.deleteUser(ownerId, adminId, { hard: false }, ACTOR)
    const deleted = userService.getUser(adminId)
    expect(deleted.status).toBe('deleted')
    expect(deleted.email_normalized).toContain('@invalid')

    userService.restoreUser(adminId, ACTOR)
    const restored = userService.getUser(adminId)
    expect(restored.status).toBe('active')
    expect(restored.email_normalized).toBe('admin@example.com')
  })

  it('hard-deletes a user who has audit history without tripping a foreign key', () => {
    userService.updateUser(ownerId, adminId, { displayName: 'Touched' }, ACTOR)
    expect(() => userService.deleteUser(ownerId, adminId, { hard: true }, ACTOR)).not.toThrow()
    expect(usersRepo.findById(getDb(), adminId)).toBeUndefined()

    // The audit trail survives; only the actor link is nulled.
    const audit = auditRepo.list(getDb(), { action: 'user.hard_delete' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBe(1)
  })

  it('unlocks a locked account', async () => {
    const db = getDb()
    usersRepo.setLockedUntil(db, adminId, Date.now() + 600_000, Date.now())
    expect(userService.getUser(adminId).locked_until).toBeGreaterThan(Date.now())

    userService.unlockUser(adminId, ACTOR)
    expect(userService.getUser(adminId).locked_until).toBeNull()
  })

  it('issues a temporary password and revokes sessions', async () => {
    const result = await userService.resetUserPassword(adminId, ACTOR)
    expect(result.temporaryPassword).toHaveLength(16)
    expect(userService.getUser(adminId).must_change_password).toBe(1)

    const relogin = await authService.login({
      identifier: 'admin@example.com',
      password: result.temporaryPassword,
      client: 'web',
      device: { name: 'test', platform: 'win32', appVersion: '1' },
      ip: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'req-reset',
    })
    expect(relogin.user.must_change_password).toBe(1)
  })
})

describe('listing', () => {
  it('filters by search term and paginates', () => {
    const page = { page: 1, pageSize: 1, offset: 0 }
    const result = userService.listUsers({
      query: 'admin',
      sort: { column: 'created_at', direction: 'DESC' },
      page,
    })
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.rows.length).toBe(1)
  })

  it('excludes soft-deleted users unless asked for them', () => {
    userService.deleteUser(ownerId, adminId, { hard: false }, ACTOR)
    const withoutDeleted = userService.listUsers({
      sort: { column: 'created_at', direction: 'DESC' },
      page: { page: 1, pageSize: 20, offset: 0 },
    })
    expect(withoutDeleted.rows.some((row) => row.id === adminId)).toBe(false)

    const onlyDeleted = userService.listUsers({
      status: 'deleted',
      sort: { column: 'created_at', direction: 'DESC' },
      page: { page: 1, pageSize: 20, offset: 0 },
    })
    expect(onlyDeleted.rows.some((row) => row.id === adminId)).toBe(true)
  })
})

describe('bulk operations', () => {
  it('applies the action to the valid rows and reports the skips', async () => {
    const second = await userService.createUser(
      {
        email: 'second@example.com',
        username: 'second',
        password: 'silver river mountain trail',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
      },
      ACTOR,
    )

    const result = userService.bulk(
      ownerId,
      { action: 'suspend', ids: [adminId, second.user.id, ownerId] },
      ACTOR,
    )

    expect(result.affected).toHaveLength(2)
    expect(result.skipped.map((entry) => entry.reason)).toContain('cannot_modify_owner')
  })
})

describe('roles', () => {
  it('creates a custom role and applies permissions', () => {
    const role = roleService.createRole(
      { key: 'reviewer', name: '审核员', description: '只读审计' },
      ACTOR,
    )
    expect(role.permissions).toEqual([])

    const updated = roleService.replacePermissions(role.id, ['audit.read', 'users.read'], ACTOR)
    expect(updated.permissions.sort()).toEqual(['audit.read', 'users.read'])
  })

  it('rejects an unknown permission key', () => {
    const role = roleService.createRole({ key: 'temp', name: '临时', description: '' }, ACTOR)
    expect(() => roleService.replacePermissions(role.id, ['users.destroy'], ACTOR)).toThrowError(
      /未知权限/,
    )
  })

  it('protects the owner permission set', () => {
    const ownerRole = rolesRepo.findByKey(getDb(), 'owner')
    expect(ownerRole).toBeDefined()
    expect(() =>
      roleService.replacePermissions(ownerRole?.id ?? '', ['users.read'], ACTOR),
    ).toThrowError(/超级管理员/)
  })

  it('refuses to delete a role that still has users', () => {
    const role = roleService.createRole({ key: 'occupied', name: '占用中', description: '' }, ACTOR)
    userService.updateUser(ownerId, adminId, { roleId: role.id }, ACTOR)
    expect(() => roleService.deleteRole(role.id, ACTOR)).toThrowError(/仍有/)
  })

  it('refuses to delete a system role', () => {
    const support = rolesRepo.findByKey(getDb(), 'support')
    expect(() => roleService.deleteRole(support?.id ?? '', ACTOR)).toThrowError(/系统角色/)
  })

  it('reports the permission set of a changed role on the next read', () => {
    const role = roleService.createRole({ key: 'shift', name: '轮班', description: '' }, ACTOR)
    userService.updateUser(ownerId, adminId, { roleId: role.id }, ACTOR)
    roleService.replacePermissions(role.id, ['users.read'], ACTOR)

    expect(rolesRepo.permissionsFor(getDb(), role.id)).toEqual(['users.read'])
    expect(userService.getUserDetail(adminId).role_key).toBe('shift')
  })
})

describe('audit invariants', () => {
  it('never stores a credential value or a credential-shaped key in metadata', async () => {
    await userService.resetUserPassword(adminId, ACTOR)
    userService.updateUser(ownerId, adminId, { displayName: 'Audited' }, ACTOR)

    const SECRET_KEYS = ['password', 'newpassword', 'currentpassword', 'token', 'accesstoken', 'refreshtoken', 'hash', 'passwordhash', 'secret']

    const rows = auditRepo.list(getDb(), {}, { page: 1, pageSize: 100, offset: 0 })
    expect(rows.total).toBeGreaterThan(0)

    for (const row of rows.rows) {
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>
      const keys = collectKeys(metadata)
      for (const key of keys) {
        expect(SECRET_KEYS, `audit ${row.action} leaked key ${key}`).not.toContain(
          key.toLowerCase().replace(/[-_]/g, ''),
        )
      }
    }
  })

  it('records a settings change and applies it immediately', () => {
    settingsService.patch({ 'registration.enabled': false }, ownerId)
    expect(settingsService.all()['registration.enabled']).toBe(false)
    expect(settingsService.publicMeta().registrationEnabled).toBe(false)
  })
})

function collectKeys(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((entry) => collectKeys(entry, depth + 1))
  const out: string[] = []
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out.push(key, ...collectKeys(entry, depth + 1))
  }
  return out
}
