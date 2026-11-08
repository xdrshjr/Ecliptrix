import { getDb } from '@/server/db/client'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  isKnownPermission,
  sortPermissions,
} from '@/server/auth/permissions'
import { ERROR_CODE } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import { newId } from '@/server/auth/tokens'
import * as auditService from '@/server/services/auditService'
import type { AuditContext } from '@/server/services/auditService'
import type { RoleWithPermissions } from '@/server/db/repositories/rolesRepo'

/**
 * Role and permission administration.
 *
 * Rules enforced here (spec §2.9 item 12/13):
 *  - the `owner` role's permission set is immutable and always `['*']`;
 *  - system roles can be renamed but never deleted;
 *  - a role that still has users cannot be deleted;
 *  - permission keys are validated against the catalogue, so a typo cannot grant
 *    nothing while looking like it granted something.
 */

export const OWNER_ROLE_KEY = 'owner'

function roleChangeJournal(
  roleId: string,
  roleKey: string,
  actorLabel: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO role_change_events
       (id, role_id, role_key, actor_label, changed_at, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    roleId,
    roleKey,
    actorLabel,
    Date.now(),
    JSON.stringify([...before]),
    JSON.stringify([...after]),
  )
}

export function listRoles(): RoleWithPermissions[] {
  return rolesRepo.listWithPermissions(getDb())
}

export function getRole(id: string): RoleWithPermissions {
  const role = rolesRepo.findById(getDb(), id)
  if (!role) throw errors.notFound('角色不存在')
  return {
    ...role,
    permissions: rolesRepo.permissionsFor(getDb(), role.id),
    user_count: rolesRepo.userCount(getDb(), role.id),
  }
}

export function permissionsOf(roleId: string): string[] {
  return rolesRepo.permissionsFor(getDb(), roleId)
}

export function createRole(
  input: { key: string; name: string; description: string; permissions?: string[] },
  actor: AuditContext,
): RoleWithPermissions {
  const db = getDb()
  const now = Date.now()
  if (rolesRepo.findByKey(db, input.key)) {
    throw new AppError(ERROR_CODE.conflict, '该角色标识已存在')
  }
  const permissions = input.permissions ?? []
  assertPermissionsKnown(permissions)

  const id = newId()
  const create = db.transaction(() => {
    rolesRepo.create(db, {
      id,
      key: input.key,
      name: input.name,
      description: input.description,
      isSystem: false,
      permissions,
      now,
    })
  })
  create()

  roleChangeJournal(id, input.key, actor.actorLabel, [], permissions)
  auditService.record(actor, {
    action: 'role.create',
    targetType: 'role',
    targetId: id,
    metadata: { key: input.key, permissions },
  })
  return getRole(id)
}

export function updateRole(
  id: string,
  input: { name?: string; description?: string },
  actor: AuditContext,
): RoleWithPermissions {
  const db = getDb()
  const role = rolesRepo.findById(db, id)
  if (!role) throw errors.notFound('角色不存在')
  rolesRepo.update(db, id, input, Date.now())
  auditService.record(actor, {
    action: 'role.update',
    targetType: 'role',
    targetId: id,
    metadata: auditService.diff(
      { name: role.name, description: role.description },
      { name: input.name, description: input.description },
    ),
  })
  return getRole(id)
}

export function deleteRole(id: string, actor: AuditContext): void {
  const db = getDb()
  const role = rolesRepo.findById(db, id)
  if (!role) throw errors.notFound('角色不存在')
  if (role.is_system === 1) {
    throw new AppError(ERROR_CODE.systemRoleProtected, '系统角色不可删除')
  }
  if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(role.key)) {
    throw new AppError(ERROR_CODE.systemRoleProtected, '系统角色不可删除')
  }
  const holders = usersRepo.countByRole(db, id)
  if (holders > 0) {
    throw new AppError(ERROR_CODE.roleInUse, `该角色仍有 ${holders} 位用户，请先转移`)
  }
  rolesRepo.remove(db, id)
  auditService.record(actor, {
    action: 'role.delete',
    targetType: 'role',
    targetId: id,
    metadata: { key: role.key },
  })
}

function assertPermissionsKnown(permissions: readonly string[]): void {
  const unknown = permissions.filter((permission) => !isKnownPermission(permission))
  if (unknown.length > 0) {
    throw new AppError(ERROR_CODE.validationFailed, '存在未知权限键', {
      details: { fields: unknown.map((key) => ({ path: key, message: '未知权限' })) },
    })
  }
}

/**
 * Replace a role's permission set.
 *
 * @throws AppError `system_role_protected` when the target is `owner` — that set
 *         is generated, not stored, so an edit would be silently ignored.
 */
export function replacePermissions(
  id: string,
  permissions: readonly string[],
  actor: AuditContext,
): RoleWithPermissions {
  const db = getDb()
  const role = rolesRepo.findById(db, id)
  if (!role) throw errors.notFound('角色不存在')
  if (role.key === OWNER_ROLE_KEY) {
    throw new AppError(ERROR_CODE.systemRoleProtected, '超级管理员的权限集合固定为 *，不可修改')
  }
  assertPermissionsKnown(permissions)

  const unique = sortPermissions([...new Set(permissions)].filter((p) => p !== '*'))
  const before = rolesRepo.permissionsFor(db, id)
  const apply = db.transaction(() => {
    rolesRepo.replacePermissions(db, id, unique)
  })
  apply()

  roleChangeJournal(id, role.key, actor.actorLabel, before, unique)
  auditService.record(actor, {
    action: 'role.permissions_replaced',
    targetType: 'role',
    targetId: id,
    metadata: { before, after: unique },
  })
  return getRole(id)
}

/** Catalogue exposed to the console so labels and keys cannot drift. */
export function permissionCatalogue(): { known: readonly string[]; all: readonly string[] } {
  return { known: [...ALL_PERMISSIONS], all: [...ALL_PERMISSIONS] }
}
