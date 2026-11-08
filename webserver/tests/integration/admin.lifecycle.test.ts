import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import * as userService from '@/server/services/userService'
import * as settingsService from '@/server/services/settingsService'
import * as sessionService from '@/server/services/sessionService'
import { getDb } from '@/server/db/client'
import { auditRepo, usersRepo } from '../setup/repos'
import { resetAll } from '@/server/auth/rateLimit'
import type { AuditContext } from '@/server/services/auditService'

/**
 * Regressions found while reviewing the delivered feature.
 *
 * Each case pins a defect that the original suite could not see: account
 * recovery, the hard-delete foreign key, and the self-service activity feed.
 */

let harness: TestHarness
let ownerId: string
let ACTOR: AuditContext

const PASSWORD = 'bright harbour lantern path'

async function makeUser(email: string, username: string, roleKey = 'member'): Promise<string> {
  const created = await userService.createUser(
    {
      email,
      username,
      password: PASSWORD,
      status: 'active',
      planTag: 'free',
      note: '',
      mustChangePassword: false,
      roleKey,
    },
    ACTOR,
  )
  return created.user.id
}

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const db = getDb()
  const owner = usersRepo.findByEmailOrUsername(db, 'owner@example.com', 'owner')
  if (!owner) throw new Error('seed owner missing')
  ownerId = owner.id
  ACTOR = {
    actorUserId: ownerId,
    actorLabel: 'owner@example.com',
    ip: '127.0.0.1',
    requestId: 'req-regression',
  }
})

afterEach(() => {
  harness.teardown()
})

describe('soft delete is recoverable', () => {
  it('writes user.delete metadata that restore can read back', async () => {
    const id = await makeUser('recover@example.com', 'recover')

    userService.deleteUser(ownerId, id, { hard: false }, ACTOR)

    const row = usersRepo.findById(getDb(), id)
    expect(row?.status).toBe('deleted')
    // The tombstone is what makes the address reusable; the audit row is the
    // only surviving copy of the original.
    expect(row?.email_normalized).toBe(`deleted+${id}@invalid`)

    const metadata = auditRepo.lastMetadataFor(getDb(), 'user', id, 'user.delete')
    expect(metadata?.email).toBe('recover@example.com')
    expect(metadata?.username).toBe('recover')

    const restored = userService.restoreUser(id, ACTOR)
    expect(restored.status).toBe('active')
    expect(restored.email_normalized).toBe('recover@example.com')
    expect(restored.deleted_at).toBeNull()
  })

  it('recovers an account deleted through PATCH status=deleted', async () => {
    const id = await makeUser('patched@example.com', 'patched')

    // Regression: this path used to write `user.update`, so no `user.delete`
    // metadata existed and `restoreUser` answered "原始邮箱记录缺失" forever.
    userService.updateUser(ownerId, id, { status: 'deleted' }, ACTOR)

    const metadata = auditRepo.lastMetadataFor(getDb(), 'user', id, 'user.delete')
    expect(metadata?.email).toBe('patched@example.com')

    const restored = userService.restoreUser(id, ACTOR)
    expect(restored.status).toBe('active')
    expect(restored.email_normalized).toBe('patched@example.com')
  })

  it('activates a deleted account by undoing the tombstone, not just the flag', async () => {
    const id = await makeUser('activate@example.com', 'activate')

    userService.deleteUser(ownerId, id, { hard: false }, ACTOR)
    // Regression: PATCH status=active used to leave deleted_at set and the
    // email_normalized tombstone in place, producing an account that could
    // never log in while its real address read as free to the next signup.
    const activated = userService.updateUser(ownerId, id, { status: 'active' }, ACTOR)

    expect(activated.status).toBe('active')
    expect(activated.deleted_at).toBeNull()
    expect(activated.email_normalized).toBe('activate@example.com')

    const db = getDb()
    expect(usersRepo.findByEmailOrUsername(db, 'activate@example.com', 'activate')?.id).toBe(id)
  })
})

describe('hard delete', () => {
  it('succeeds for an account that has saved a setting', async () => {
    const id = await makeUser('setter@example.com', 'setter')
    // `app_settings.updated_by` holds a real user id; without SET NULL (or the
    // repository clearing it first) this DELETE fails with a foreign-key error.
    settingsService.patch({ 'security.loginMaxAttempts': 6 }, id)

    expect(() => userService.deleteUser(ownerId, id, { hard: true }, ACTOR)).not.toThrow()
    expect(usersRepo.findById(getDb(), id)).toBeUndefined()
    expect(auditRepo.lastMetadataFor(getDb(), 'user', id, 'user.hard_delete')?.email).toBe(
      'setter@example.com',
    )
  })

  it('revokes every session before the row disappears', async () => {
    const id = await makeUser('sessioned@example.com', 'sessioned')
    const session = sessionService.createSession({
      userId: id,
      client: 'web',
      ip: '127.0.0.1',
      userAgent: 'vitest',
      deviceName: 'test',
    })

    expect(sessionService.sessionFromAccessToken(session.accessToken)).toBeDefined()

    userService.deleteUser(ownerId, id, { hard: true }, ACTOR)

    // Gone either by the explicit revocation or by the `ON DELETE CASCADE` on
    // sessions.user_id; what matters is that the token no longer resolves.
    expect(sessionService.sessionFromAccessToken(session.accessToken)).toBeUndefined()
  })
})

describe('self-service activity feed', () => {
  it('hides actions outside the allowlist and rows older than the window', async () => {
    const id = await makeUser('viewer@example.com', 'viewer')
    const db = getDb()
    const now = Date.now()
    const insert = (action: string, createdAt: number): void => {
      auditRepo.insert(db, {
        id: `audit-${action}-${createdAt}`,
        actorUserId: id,
        actorLabel: 'viewer@example.com',
        action,
        targetType: 'user',
        targetId: id,
        metadata: {},
        ip: '127.0.0.1',
        requestId: 'req',
        now: createdAt,
      })
    }

    insert('auth.login', now - 1000)
    // Not in SELF_VISIBLE_ACTIONS: an administrator's own trail.
    insert('settings.update', now - 1000)
    insert('role.update', now - 1000)
    // Inside the allowlist but outside the 90-day window.
    insert('auth.login', now - 100 * 24 * 60 * 60 * 1000)

    // Regression: `WHERE actor = ? OR (target) AND created_at >= ? AND action IN (…)`
    // bound AND tighter than OR, so the actor branch escaped both filters and the
    // feed leaked the caller's entire history.
    const { rows, total } = auditRepo.listForUser(db, id, now - 90 * 24 * 60 * 60 * 1000, {
      page: 1,
      pageSize: 20,
      offset: 0,
    })

    expect(rows.map((row) => row.action)).toEqual(['auth.login'])
    expect(total).toBe(1)
  })

  it('still returns events where the caller is the target', async () => {
    const id = await makeUser('targeted@example.com', 'targeted')
    auditRepo.insert(getDb(), {
      id: 'audit-targeted',
      actorUserId: ownerId,
      actorLabel: 'owner@example.com',
      action: 'user.profile_updated',
      targetType: 'user',
      targetId: id,
      metadata: {},
      ip: '127.0.0.1',
      requestId: 'req',
      now: Date.now(),
    })

    const { rows } = auditRepo.listForUser(getDb(), id, Date.now() - 1000, {
      page: 1,
      pageSize: 20,
      offset: 0,
    })
    expect(rows.map((row) => row.action)).toEqual(['user.profile_updated'])
  })
})
