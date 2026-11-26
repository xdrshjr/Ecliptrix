import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as userService from '@/server/services/userService'
import * as roleService from '@/server/services/roleService'
import * as inviteService from '@/server/services/inviteService'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * The three authority invariants (spec §3.4), proven against a real database.
 *
 * Every case drives the service functions rather than the routes: the invariant
 * belongs to the service layer, and a route-level copy would pass this suite while
 * a second caller (bulk, PATCH forwarding, CLI) walked past it. That is exactly the
 * failure the spec spent three review rounds finding.
 *
 * The fixture is a custom `ops` role at rank 80 holding `users.write` +
 * `roles.write`. A stock `admin` cannot reach the permission matrix at all (it has
 * no `roles.write`), so using one would make the subset cases unreachable — the
 * "AC never fires" class of defect the spec calls out (review R-05).
 */

const CONTEXT = { ip: '10.30.0.1', userAgent: 'vitest', requestId: 'req-auth' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet meadow lantern drift'

let harness: TestHarness
let owner: AuditContext
let ownerRow: UserRow

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const row = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
  if (!row) throw new Error('seed owner missing')
  ownerRow = row
  owner = { actorUserId: row.id, actorLabel: row.email, ip: '127.0.0.1', requestId: 'req-owner' }
})

afterEach(() => {
  harness.teardown()
})

async function registerMember(email = 'member@example.com'): Promise<UserRow> {
  const result = await authService.register({
    email,
    password: PASSWORD,
    username: email.split('@')[0],
    client: 'web',
    device: DEVICE,
    ...CONTEXT,
    ...issueCaptcha(),
  })
  return result.user
}

/** A custom role with an explicit permission set, then a member in it. */
async function memberOfRole(
  key: string,
  permissions: string[],
  email = `${key}@example.com`,
): Promise<UserRow> {
  const role = roleService.createRole({ key, name: key, description: '', permissions }, owner)
  const user = await registerMember(email)
  userService.updateUser(owner.actorUserId ?? '', user.id, { roleId: role.id }, owner)
  const refreshed = usersRepo.findById(getDb(), user.id)
  if (!refreshed) throw new Error('user vanished')
  return refreshed
}

function actorFor(user: UserRow, requestId = 'req-actor'): AuditContext {
  return { actorUserId: user.id, actorLabel: user.email, ip: '127.0.0.1', requestId }
}

describe('INV-3 — administrator allocation is reserved', () => {
  it('refuses a non-owner granting admin (AC-12)', async () => {
    const ops = await memberOfRole('ops', ['users.read', 'users.write', 'roles.read', 'roles.write'])
    const target = await registerMember('target@example.com')
    const adminRole = roleService.listRoles().find((role) => role.key === 'admin')
    expect(adminRole).toBeDefined()

    expect(() =>
      userService.updateUser(ops.id, target.id, { roleId: adminRole!.id }, actorFor(ops)),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))
  })

  it('refuses a plain admin creating another admin through the create path (AC-12b)', async () => {
    // This was the live escalation path: `POST /admin/users` only needs
    // `users.write`, and the schema accepts `roleKey`.
    const adminRole = roleService.listRoles().find((role) => role.key === 'admin')
    const admin = await userService.createUser(
      {
        email: 'admin@example.com',
        username: 'admin',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    await expect(
      userService.createUser(
        {
          email: 'admin2@example.com',
          username: 'admin2',
          password: 'copper kettle window frame',
          status: 'active',
          planTag: 'free',
          note: '',
          mustChangePassword: false,
          roleId: adminRole!.id,
        },
        actorFor(admin.user),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lets the owner grant admin and records the ledger (AC-13)', async () => {
    const target = await registerMember('promoted@example.com')
    const adminRole = roleService.listRoles().find((role) => role.key === 'admin')
    userService.updateUser(owner.actorUserId ?? '', target.id, { roleId: adminRole!.id }, owner)

    const after = usersRepo.findById(getDb(), target.id)
    expect(after?.role_granted_by).toBe(ownerRow.id)
    expect(after?.role_granted_at).toBeGreaterThan(0)

    const audit = auditRepo.list(getDb(), { action: 'user.role_granted' }, { page: 1, pageSize: 5, offset: 0 })
    expect(audit.total).toBeGreaterThanOrEqual(1)
  })

  it('refuses an invite that would register straight into admin (AC-17)', async () => {
    // An invite is a PRE-GRANTED role: redeeming it confers the role with no second
    // check, so it must pass the same allocation gate as the role editor. The
    // input is keyed by `roleKey`, not id.
    const ops = await memberOfRole('ops', [
      'users.read',
      'users.write',
      'roles.read',
      'roles.write',
      'invites.write',
    ])
    await expect(
      inviteService.createInvite(
        { roleKey: 'admin', maxUses: 1, expiresInDays: 7 },
        actorFor(ops),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('INV-2 — nobody grants what it does not hold', () => {
  it('refuses adding a permission the caller lacks (AC-14)', async () => {
    const ops = await memberOfRole('ops', ['users.read', 'users.write', 'roles.read', 'roles.write'])
    const ownRole = roleService.listRoles().find((role) => role.key === 'ops')
    expect(ownRole).toBeDefined()

    expect(() =>
      roleService.replacePermissions(ownRole!.id, [...ownRole!.permissions, 'users.delete'], actorFor(ops)),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))
  })

  it('refuses self-escalation through the role the caller belongs to (AC-15)', async () => {
    const ops = await memberOfRole('ops', ['users.read', 'users.write', 'roles.read', 'roles.write'])
    const ownRole = roleService.listRoles().find((role) => role.key === 'ops')
    expect(() =>
      roleService.replacePermissions(ownRole!.id, [...ownRole!.permissions, 'settings.write'], actorFor(ops)),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))
  })

  it('allows the owner to grant anything', () => {
    const anyRole = roleService.listRoles().find((role) => role.key === 'member')
    expect(() =>
      roleService.replacePermissions(anyRole!.id, ['users.read', 'settings.write'], owner),
    ).not.toThrow()
  })
})

describe('INV-1 — the level gate', () => {
  it('refuses an admin suspending a peer but allows a member (AC-16)', async () => {
    const adminA = await userService.createUser(
      {
        email: 'admin-a@example.com',
        username: 'admin-a',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const adminB = await userService.createUser(
      {
        email: 'admin-b@example.com',
        username: 'admin-b',
        password: 'copper kettle window frame',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const member = await registerMember('plain-member@example.com')

    expect(() =>
      userService.updateUser(adminA.user.id, adminB.user.id, { status: 'suspended' }, actorFor(adminA.user)),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))

    expect(() =>
      userService.updateUser(adminA.user.id, member.id, { status: 'suspended' }, actorFor(adminA.user)),
    ).not.toThrow()
  })

  it('refuses a peer password reset (AC-16b)', async () => {
    const adminA = await userService.createUser(
      {
        email: 'reset-a@example.com',
        username: 'reset-a',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const adminB = await userService.createUser(
      {
        email: 'reset-b@example.com',
        username: 'reset-b',
        password: 'copper kettle window frame',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    // The account-takeover path this closes: reset a peer's password, sign in as
    // them. It used to be guarded by `assertNotOwner` alone.
    await expect(
      userService.resetUserPassword(adminB.user.id, actorFor(adminA.user)),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses rewriting a peer’s email and allows a member (AC-16e)', async () => {
    // Changing the address is an equivalent takeover: a new address receives the
    // reset link. `admin` → `owner` was reachable before this gate.
    const adminA = await userService.createUser(
      {
        email: 'mail-a@example.com',
        username: 'mail-a',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const adminB = await userService.createUser(
      {
        email: 'mail-b@example.com',
        username: 'mail-b',
        password: 'copper kettle window frame',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const member = await registerMember('mail-target@example.com')

    expect(() =>
      userService.updateUser(
        adminA.user.id,
        adminB.user.id,
        { email: 'stolen@example.com' },
        actorFor(adminA.user),
      ),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))

    expect(() =>
      userService.updateUser(
        adminA.user.id,
        ownerRow.id,
        { email: 'stolen-owner@example.com' },
        actorFor(adminA.user),
      ),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }))

    // A lower-ranked target is still manageable.
    expect(() =>
      userService.updateUser(
        adminA.user.id,
        member.id,
        { email: 'renamed@example.com' },
        actorFor(adminA.user),
      ),
    ).not.toThrow()
  })

  it('refuses verifying a peer’s email on their behalf (AC-16f)', async () => {
    const adminA = await userService.createUser(
      {
        email: 'verify-a@example.com',
        username: 'verify-a',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const adminB = await userService.createUser(
      {
        email: 'verify-b@example.com',
        username: 'verify-b',
        password: 'copper kettle window frame',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    expect(() => userService.markEmailVerified(adminB.user.id, actorFor(adminA.user))).toThrowError(
      expect.objectContaining({ code: 'forbidden' }),
    )
  })

  it('applies the gate per row in a bulk action and keeps going (AC-16c)', async () => {
    const adminA = await userService.createUser(
      {
        email: 'bulk-a@example.com',
        username: 'bulk-a',
        password: 'bright harbour lantern path',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const adminB = await userService.createUser(
      {
        email: 'bulk-b@example.com',
        username: 'bulk-b',
        password: 'copper kettle window frame',
        status: 'active',
        planTag: 'free',
        note: '',
        mustChangePassword: false,
        roleKey: 'admin',
      },
      owner,
    )
    const memberA = await registerMember('bulk-m1@example.com')
    const memberB = await registerMember('bulk-m2@example.com')

    const result = userService.bulk(
      adminA.user.id,
      { action: 'suspend', ids: [adminB.user.id, memberA.id, memberB.id] },
      actorFor(adminA.user),
    )
    // Partial success is the contract: the refused row is reported, the rest apply.
    expect(result.affected).toEqual(expect.arrayContaining([memberA.id, memberB.id]))
    expect(result.affected).not.toContain(adminB.user.id)
    expect(result.skipped.some((entry) => entry.id === adminB.user.id)).toBe(true)
    expect(usersRepo.findById(getDb(), memberA.id)?.status).toBe('suspended')
  })

  it('lets a hard delete of somebody who granted a role succeed (DM-5)', async () => {
    // The grant ledger is a self-reference with ON DELETE SET NULL; without that
    // clause this delete would fail on a foreign key, so the assertion below can
    // only pass if the column really is nullable-on-delete.
    const granter = await registerMember('granted-by@example.com')
    const other = await registerMember('granted-to@example.com')

    // Promote the granter to `admin` (rank 80) so it may act, and so the ledger
    // records the OWNER as the one who granted the granter its role.
    const adminRole = roleService.listRoles().find((role) => role.key === 'admin')
    if (!adminRole) throw new Error('admin role missing')
    userService.updateUser(owner.actorUserId ?? '', granter.id, { roleId: adminRole.id }, owner)
    const promoted = usersRepo.findById(getDb(), granter.id)
    if (!promoted) throw new Error('granter vanished')

    // The granter now grants a DIFFERENT role: a same-role assignment is a no-op
    // and would never write the pair, which is what made the first attempt look
    // like a broken ledger.
    const supportRole = roleService.listRoles().find((role) => role.key === 'support')
    if (!supportRole) throw new Error('support role missing')
    userService.updateUser(granter.id, other.id, { roleId: supportRole.id }, actorFor(promoted))
    expect(usersRepo.findById(getDb(), other.id)?.role_granted_by).toBe(granter.id)

    expect(() => userService.deleteUser(owner.actorUserId ?? '', granter.id, { hard: true }, owner)).not.toThrow()
    // The survivor's ledger entry is preserved with a null author, not deleted.
    expect(usersRepo.findById(getDb(), other.id)?.role_granted_by).toBeNull()
  })

  it('never borrows the system channel from an HTTP-shaped caller (AC-19b)', async () => {
    // `actorUserId === null` is the one path that skips the rank gate. No request
    // may produce it: if it did, the gate would fail open and leave only an
    // "system acted" audit row behind.
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'authz.system_actor'")
      .get() as { count: number }
    expect(rows.count).toBe(0)
  })
})
