import { getDb } from '@/server/db/client'
import type { Db } from '@/server/db/client'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import { RESERVED_ALLOCATION_RANK, hasPermission } from '@/server/auth/permissions'
import { ERROR_CODE } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as auditService from '@/server/services/auditService'
import type { RoleRow } from '@/server/db/types'

/**
 * The three authority invariants (spec §3.4).
 *
 * Before this module there were two live escalation paths:
 *
 *  1. `roleService.replacePermissions` filtered only `'*'`, so a role holding
 *     `roles.write` could grant itself `users.delete`, `settings.write`, … — and
 *     from there reach everything.
 *  2. `userService.createUser` accepted `roleKey: 'admin'` from any holder of
 *     `users.write`, so a plain administrator could mint another administrator,
 *     and `inviteService.createInvite` could issue a code that registers straight
 *     into `admin`.
 *
 * Both are now impossible because every grant path asks this file. The module is
 * read-and-decide only: it never writes, so it cannot become a second source of
 * truth for who holds what.
 *
 * ## Why the actor is passed as an id, not as permissions
 *
 * `AuditContext` is the shape every service already takes, and it carries no
 * permissions. The tempting shortcut — stuffing `permissions` into `AuditContext`
 * — would turn an audit record into an authorisation credential, and CLI callers
 * plus audit replay would both be able to forge it. Instead the caller passes
 * `actorUserId`, and this module resolves the real rank and permission set from
 * the database. The cost is two primary-key lookups on a path that already writes
 * three tables.
 */

interface ResolvedActor {
  userId: string
  roleKey: string
  rank: number
  permissions: string[]
}

/**
 * Resolve a caller's rank and permissions from the database.
 *
 * `null` when the id does not exist or has no role — a caller that cannot be
 * resolved is treated as unprivileged by every invariant below, which is the safe
 * direction.
 */
function resolveActor(db: Db, actorUserId: string | null): ResolvedActor | null {
  if (actorUserId === null) return null
  const user = usersRepo.findById(db, actorUserId)
  if (!user) return null
  const role = rolesRepo.findById(db, user.role_id)
  if (!role) return null
  return {
    userId: user.id,
    roleKey: role.key,
    rank: role.rank,
    permissions: rolesRepo.permissionsFor(db, role.id),
  }
}

/** Audit row for a refused escalation — one action, distinguishing it from "denied". */
function recordEscalationDenied(
  actor: ResolvedActor,
  target: { type: string; id: string },
  metadata: Record<string, unknown>,
): void {
  auditService.record(
    { actorUserId: actor.userId, actorLabel: '', ip: '', requestId: '' },
    {
      action: 'authz.escalation_denied',
      targetType: target.type,
      targetId: target.id,
      metadata,
    },
  )
}

/**
 * INV-1 — the level gate.
 *
 * Every *weakening* action (suspend, delete, demote, password reset, restore,
 * unlock) must require `actor.rank > target.rank`. Same-rank operations are
 * refused on principle: an `admin` suspending another `admin` is a coup, not
 * governance. The owner is rank 100 and is separately un-modifiable, so the
 * existing `assertNotOwner` still stands on its own.
 *
 * A `null` actor is the system (seed, CLI, auto-unlock): it is already the
 * highest authority in the process and cannot escalate through a request, so it
 * passes and leaves an audit trace.
 *
 * @throws {AppError} `forbidden` with `details.reason = 'insufficient_rank'`.
 */
export function assertRankAbove(actorUserId: string | null, targetUserId: string): void {
  const db = getDb()
  const target = usersRepo.findById(db, targetUserId)
  if (!target) throw errors.notFound('用户不存在')
  const targetRole = rolesRepo.findById(db, target.role_id)
  const targetRank = targetRole?.rank ?? 0

  if (actorUserId === null) {
    auditService.record(auditService.SYSTEM_ACTOR, {
      action: 'authz.system_actor',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { check: 'rank_above', targetRank },
    })
    return
  }

  const actor = resolveActor(db, actorUserId)
  if (actor && actor.rank > targetRank) return

  if (actor) {
    recordEscalationDenied(
      actor,
      { type: 'user', id: targetUserId },
      {
        check: 'rank_above',
        actorRank: actor.rank,
        targetRank,
        actorRole: actor.roleKey,
        targetRole: targetRole?.key ?? '',
      },
    )
  }
  throw new AppError(ERROR_CODE.forbidden, '不能操作同级或更高等级的管理员', {
    details: { reason: 'insufficient_rank', actorRank: actor?.rank ?? 0, targetRank },
  })
}

function forbiddenExceeds(excess: readonly string[]): AppError {
  return new AppError(ERROR_CODE.forbidden, '不能授予自己不具备的权限', {
    details: { reason: 'permission_exceeds_actor', permissions: excess },
  })
}

/**
 * Non-throwing form of INV-1, for callers that must keep going.
 *
 * Bulk actions answer a "partially succeeded" contract: one refused row must not
 * abort the batch, so those callers need the decision as a boolean and record the
 * refusal themselves (`details.reason = 'insufficient_rank'` on the skipped
 * entry). Single-item callers should keep using `assertRankAbove`, which also
 * writes the `authz.escalation_denied` row.
 *
 * A `null` actor is the system and passes, matching `assertRankAbove`.
 */
export function isRankAbove(actorUserId: string | null, targetUserId: string): boolean {
  if (actorUserId === null) return true
  const db = getDb()
  const target = usersRepo.findById(db, targetUserId)
  if (!target) return false
  const targetRank = rolesRepo.findById(db, target.role_id)?.rank ?? 0
  const actor = resolveActor(db, actorUserId)
  if (!actor) return false
  if (actor.rank > targetRank) return true
  recordEscalationDenied(
    actor,
    { type: 'user', id: targetUserId },
    { check: 'rank_above', actorRank: actor.rank, targetRank, actorRole: actor.roleKey },
  )
  return false
}

/**
 * Can this caller revoke (or list) this account's sessions?
 *
 * Same rule as INV-1 with one addition: an actor always reaches its OWN sessions.
 * Revoking your own device is a sign-out, not governance — it can only hurt you —
 * and refusing it would mean an administrator cannot clear a stale device of their
 * own from the console. Every other target still needs a strictly higher rank, so
 * a same-rank peer and the owner stay out of reach (review R-V4-02).
 */
export function canRevokeSessionsOf(actorUserId: string | null, targetUserId: string): boolean {
  if (actorUserId !== null && actorUserId === targetUserId) return true
  return isRankAbove(actorUserId, targetUserId)
}

/** Throwing form of {@link canRevokeSessionsOf}, for single-session endpoints. */
export function assertCanRevokeSessionsOf(
  actorUserId: string | null,
  targetUserId: string,
): void {
  if (canRevokeSessionsOf(actorUserId, targetUserId)) return
  throw new AppError(ERROR_CODE.forbidden, '不能操作同级或更高等级的管理员', {
    details: { reason: 'insufficient_rank' },
  })
}

/**
 * INV-2 — the subset gate.
 *
 * A caller may grant only permissions it holds itself. `owner` holds `'*'` and
 * passes automatically; anybody else is limited to their own set. Used by
 * `roleService.replacePermissions` / `createRole`, `inviteService.createInvite`
 * and the role branches of `userService`.
 *
 * `'*'` is filtered out before comparison because the only role that may hold it
 * is `owner`, and granting it is refused by the callers that own role editing.
 *
 * @throws {AppError} `forbidden` with `details.reason = 'permission_exceeds_actor'`.
 */
export function assertCanGrantPermissions(
  actorUserId: string | null,
  permissions: readonly string[],
): void {
  const wanted = permissions.filter((permission) => permission !== '*')
  if (wanted.length === 0) return

  if (actorUserId === null) {
    auditService.record(auditService.SYSTEM_ACTOR, {
      action: 'authz.system_actor',
      targetType: 'permission',
      targetId: '',
      metadata: { check: 'grant_permissions', permissions: wanted },
    })
    return
  }
  const actor = resolveActor(getDb(), actorUserId)
  if (!actor) throw forbiddenExceeds(wanted)
  const excess = wanted.filter((permission) => !hasPermission(actor.permissions, permission))
  if (excess.length === 0) return

  recordEscalationDenied(
    actor,
    { type: 'permission', id: '' },
    { check: 'grant_permissions', actorRole: actor.roleKey, excess },
  )
  throw forbiddenExceeds(excess)
}

/**
 * INV-3 — the allocation gate.
 *
 * A role at or above `RESERVED_ALLOCATION_RANK` (80 = `admin`) can only be
 * granted by the owner. This is the requirement "the rest of the administrators
 * are assigned by the root administrator", enforced on the server rather than by
 * hiding a button.
 *
 * `owner` itself is never grantable through the API at all (the callers refuse it
 * before reaching here), so this only ever sees admin and below.
 *
 * @throws {AppError} `forbidden` with `details.reason = 'admin_allocation_reserved'`.
 */
export function assertCanAllocateRole(
  actorUserId: string | null,
  role: Pick<RoleRow, 'key' | 'rank'>,
): void {
  if (role.rank < RESERVED_ALLOCATION_RANK) return
  if (actorUserId === null) return

  const actor = resolveActor(getDb(), actorUserId)
  if (actor?.permissions.includes('*')) return

  if (actor) {
    recordEscalationDenied(
      actor,
      { type: 'role', id: role.key },
      {
        check: 'allocate_role',
        actorRole: actor.roleKey,
        targetRole: role.key,
        requiredRank: RESERVED_ALLOCATION_RANK,
      },
    )
  }
  throw new AppError(ERROR_CODE.forbidden, '管理员任命只能由根管理员执行', {
    details: { reason: 'admin_allocation_reserved', requiredRole: 'owner' },
  })
}

/**
 * Can this caller grant `role` at all? INV-2 is checked separately because it
 * depends on the role's permission set, not just its rank.
 *
 * Exposed for the console so a role dropdown can omit what the caller may not
 * hand out. The server still re-checks on submit — a filtered dropdown is UX, not
 * a boundary.
 */
export function canGrantRole(
  actorUserId: string | null,
  role: Pick<RoleRow, 'key' | 'rank'>,
): boolean {
  if (role.key === 'owner') return false
  if (role.rank < RESERVED_ALLOCATION_RANK) return true
  if (actorUserId === null) return true
  const actor = resolveActor(getDb(), actorUserId)
  return actor?.permissions.includes('*') === true
}

/**
 * Assert every invariant required to grant `role` to somebody.
 *
 * Convenience for the role-change paths, so a caller cannot forget one of the
 * three checks: allocation (INV-3), then the permission subset of the role's own
 * set (INV-2).
 */
export function assertCanGrantRole(
  actorUserId: string | null,
  role: RoleRow,
  permissions: readonly string[],
): void {
  assertCanAllocateRole(actorUserId, role)
  assertCanGrantPermissions(actorUserId, permissions)
}

/** Roles a caller is allowed to assign, in catalogue order. */
export function grantableRoles<T extends Pick<RoleRow, 'key' | 'rank'>>(
  actorUserId: string | null,
  roles: readonly T[],
): T[] {
  return roles.filter((role) => canGrantRole(actorUserId, role))
}
