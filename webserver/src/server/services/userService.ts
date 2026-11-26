import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { hashPassword, validatePasswordPolicy } from '@/server/auth/password'
import { newId, newTempPassword } from '@/server/auth/tokens'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as sessionService from '@/server/services/sessionService'
import * as auditService from '@/server/services/auditService'
import * as authorityService from '@/server/services/authorityService'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import { displayEmail, displayUsername, normalizeEmail, normalizeUsername } from '@/server/services/normalize'
import type { AuditContext } from '@/server/services/auditService'
import type { PageRequest } from '@/server/http/pagination'
import type { UserRow, UserStatus } from '@/server/db/types'
import type { UserListFilter, UserSortColumn } from '@/server/db/repositories/usersRepo'

/**
 * Administrative user lifecycle.
 *
 * Every invariant the console depends on is enforced here, not in the UI:
 *  - an `owner` account cannot be suspended, demoted or deleted through the API;
 *  - nobody can suspend or delete themselves;
 *  - status changes revoke sessions immediately;
 *  - role changes take effect on the target's very next request because
 *    permissions are resolved per request from `role_permissions`.
 */

export const OWNER_ROLE_KEY = 'owner'

function roleKeyOf(roleId: string): string {
  return rolesRepo.findById(getDb(), roleId)?.key ?? ''
}

function assertNotOwner(user: UserRow, operation: string): void {
  if (roleKeyOf(user.role_id) === OWNER_ROLE_KEY) {
    throw new AppError(
      ERROR_CODE.cannotModifyOwner,
      `不能对超级管理员执行${operation}；请改用 CLI 或本地破窗账号`,
    )
  }
}

function assertNotSelf(actorId: string, targetId: string, operation: string): void {
  if (actorId === targetId) {
    throw new AppError(ERROR_CODE.cannotModifySelf, `不能对自己执行${operation}`)
  }
}

export interface ListUsersQuery {
  query?: string
  status?: UserStatus
  roleKey?: string
  plan?: string
  createdFrom?: number
  createdTo?: number
  sort: { column: UserSortColumn; direction: 'ASC' | 'DESC' }
  page: PageRequest
}

export function listUsers(query: ListUsersQuery): { rows: usersRepo.UserListRow[]; total: number } {
  const filter: UserListFilter = {
    query: query.query?.trim() || undefined,
    status: query.status,
    roleKey: query.roleKey,
    plan: query.plan && query.plan !== '*' ? query.plan : undefined,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    sort: query.sort,
    page: query.page,
  }
  return usersRepo.list(getDb(), filter, Date.now())
}

export function getUser(id: string): UserRow {
  const user = usersRepo.findById(getDb(), id)
  if (!user) throw errors.notFound('用户不存在')
  return user
}

/**
 * Rows for the console's CSV export.
 *
 * Shares the list filter, so "export what I am looking at" is literally true. The
 * repository fetches `limit + 1` rows so `truncated` is knowable without a second
 * count — and the flag is surfaced as a response header rather than a silent cut.
 */
export function listForExport(
  query: Omit<ListUsersQuery, 'sort' | 'page'>,
  limit: number,
): { rows: usersRepo.UserListRow[]; truncated: boolean } {
  const rows = usersRepo.listForExport(
    getDb(),
    {
      query: query.query?.trim() || undefined,
      status: query.status,
      roleKey: query.roleKey,
      plan: query.plan && query.plan !== '*' ? query.plan : undefined,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    },
    limit,
    Date.now(),
  )
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

/** Administrator override for "this user cannot receive mail". */
export function markEmailVerified(id: string, actor: AuditContext): { emailVerifiedAt: string } {
  return emailVerificationService.markVerifiedByAdmin(id, actor)
}

/** Detail view: row + role + live session count. */
export function getUserDetail(id: string): usersRepo.UserListRow {
  const detail = usersRepo.findDetailById(getDb(), id, Date.now())
  if (!detail) throw errors.notFound('用户不存在')
  return detail
}

export interface CreateUserInput {
  email: string
  username: string
  displayName?: string
  password?: string
  roleId?: string
  roleKey?: string
  status: UserStatus
  planTag: string
  note: string
  mustChangePassword: boolean
}

export interface CreateUserResult {
  user: UserRow
  temporaryPassword: string | null
}

/**
 * Create a user from the console.
 *
 * When no password is supplied a temporary one is generated, returned once and
 * paired with `must_change_password`, so the administrator never has to invent
 * (and therefore never reuses) a password.
 */
export async function createUser(
  input: CreateUserInput,
  actor: AuditContext,
): Promise<CreateUserResult> {
  const db = getDb()
  const now = Date.now()
  const emailNormalized = normalizeEmail(input.email)
  const usernameNormalized = normalizeUsername(input.username)

  if (usersRepo.emailExists(db, emailNormalized)) {
    throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被注册')
  }
  if (usersRepo.usernameExists(db, usernameNormalized)) {
    throw new AppError(ERROR_CODE.usernameTaken, '该用户名已被占用')
  }

  const role = input.roleId
    ? rolesRepo.findById(db, input.roleId)
    : input.roleKey
      ? rolesRepo.findByKey(db, input.roleKey)
      : rolesRepo.findByKey(db, 'member')
  if (!role) throw new AppError(ERROR_CODE.validationFailed, '角色不存在')
  if (role.key === OWNER_ROLE_KEY) {
    throw new AppError(ERROR_CODE.systemRoleProtected, '不能通过接口创建超级管理员，请使用 CLI')
  }
  /**
   * INV-2 + INV-3 — this was the *live* escalation path (G-3, review R-12).
   *
   * `POST /admin/users` only requires `users.write`, and `createUserSchema` accepts
   * `roleKey`, so a plain `admin` could mint another `admin` here without ever
   * touching `roles.write`. The handler's `requirePermission('roles.write')` is
   * not enough either: a custom role with both keys would still pass. The
   * allocation gate refuses `admin` from anybody but the owner, and the subset gate
   * refuses a custom role carrying permissions the caller lacks.
   */
  authorityService.assertCanGrantRole(actor.actorUserId, role, rolesRepo.permissionsFor(db, role.id))

  const temporaryPassword = input.password ? null : newTempPassword()
  const plaintext = input.password ?? temporaryPassword ?? ''
  const policy = validatePasswordPolicy({
    password: plaintext,
    email: emailNormalized,
    username: usernameNormalized,
  })
  if (!policy.ok && input.password) {
    throw new AppError(ERROR_CODE.weakPassword, '口令不符合安全要求', {
      details: { reasons: policy.reasons },
    })
  }

  const passwordHash = await hashPassword(plaintext)
  const id = newId()
  usersRepo.create(db, {
    id,
    email: displayEmail(input.email),
    emailNormalized,
    username: displayUsername(input.username),
    usernameNormalized,
    displayName: input.displayName?.trim() || displayUsername(input.username),
    passwordHash,
    roleId: role.id,
    status: input.status,
    planTag: input.planTag,
    mustChangePassword: input.mustChangePassword,
    note: input.note,
    now,
  })

  auditService.record(actor, {
    action: 'user.create',
    targetType: 'user',
    targetId: id,
    metadata: { roleKey: role.key, status: input.status, temporaryPassword: Boolean(temporaryPassword) },
  })

  const user = getUser(id)
  return { user, temporaryPassword }
}

export interface UpdateUserInput {
  email?: string
  username?: string
  displayName?: string
  roleId?: string
  status?: UserStatus
  planTag?: string
  note?: string
  avatarUrl?: string | null
}

/**
 * Patch a user.
 *
 * @throws AppError `cannot_modify_owner` / `cannot_modify_self` /
 *         `email_taken` / `username_taken`.
 */
export function updateUser(
  actorId: string,
  targetId: string,
  input: UpdateUserInput,
  actor: AuditContext,
): UserRow {
  const db = getDb()
  const now = Date.now()
  let before = getUser(targetId)
  const patch: Partial<UserRow> = {}
  /**
   * A role change is applied through `usersRepo.grantRole`, not as a field of
   * `patch`, because the role and its grant ledger (`role_granted_by/at`) are one
   * fact (DM-4). Putting `role_id` in the generic patch makes "wrote the role but
   * forgot the provenance" a one-line mistake.
   */
  let roleChange: { roleId: string; roleKey: string } | null = null

  if (input.status !== undefined && input.status !== before.status) {
    assertNotOwner(before, '停用或修改状态')
    if (input.status !== 'active') {
      assertNotSelf(actorId, targetId, '停用或删除')
      // INV-1: weakening somebody at or above the caller's own rank is a coup,
      // not governance — an `admin` may handle `support`/`member`, never a peer.
      authorityService.assertRankAbove(actorId, targetId)
    }
    // Delete and restore are lifecycle transitions with their own audit action
    // and their own tombstone bookkeeping. Running them through the generic
    // patch wrote `user.update` instead of `user.delete`, so the original
    // email/username never reached the audit trail and `restore` could not find
    // it — a PATCH-deleted account was unrecoverable. Forward instead.
    if (input.status === 'deleted') {
      deleteUser(actorId, targetId, { hard: false }, actor)
      before = getUser(targetId)
    } else if (input.status === 'active' && before.status === 'deleted') {
      // Activation of a deleted row must undo the tombstone, not just flip the
      // flag: a plain `status='active'` left `deleted_at` set and
      // `email_normalized` as `deleted+<id>@invalid`, producing an account that
      // cannot log in and whose address reads as free to the next signup.
      restoreUser(targetId, actor)
      before = getUser(targetId)
    } else {
      patch.status = input.status
    }
  }

  if (input.roleId !== undefined && input.roleId !== before.role_id) {
    assertNotOwner(before, '修改角色')
    const role = rolesRepo.findById(db, input.roleId)
    if (!role) throw new AppError(ERROR_CODE.validationFailed, '角色不存在')
    if (role.key === OWNER_ROLE_KEY) {
      throw new AppError(ERROR_CODE.forbidden, '不能把其他用户提升为超级管理员')
    }
    // INV-2 + INV-3. The role's own permission set is what will be conferred, so
    // the subset gate is evaluated against it rather than against a caller-supplied
    // list an attacker could trim.
    authorityService.assertCanGrantRole(
      actorId,
      role,
      rolesRepo.permissionsFor(db, role.id),
    )
    // Demoting somebody is also a weakening action, so the rank gate applies to
    // the target as well as the grant gate applies to the role.
    authorityService.assertRankAbove(actorId, targetId)
    // Recorded separately from the generic patch so the ledger pair and the
    // dashboard-facing action always travel together (DM-4).
    roleChange = { roleId: role.id, roleKey: role.key }
  }

  if (input.email !== undefined) {
    // INV-1, entry #8 (review R-V4-01). Changing an address looks like editing a
    // contact detail, but "an address that receives mail" is "an address that
    // receives password resets": an `admin` who rewrites a peer's — or the
    // owner's — email to their own inbox takes over the account through the
    // forgot-password flow, which walks straight past the gate on
    // `resetUserPassword`. `assertNotOwner` never ran on this branch either.
    // The gate must sit before the write, inside this branch.
    authorityService.assertRankAbove(actorId, targetId)
    const normalized = normalizeEmail(input.email)
    if (usersRepo.emailExists(db, normalized, targetId)) {
      throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被注册')
    }
    patch.email = displayEmail(input.email)
    patch.email_normalized = normalized
  }

  if (input.username !== undefined) {
    const normalized = normalizeUsername(input.username)
    if (usersRepo.usernameExists(db, normalized, targetId)) {
      throw new AppError(ERROR_CODE.usernameTaken, '该用户名已被占用')
    }
    patch.username = displayUsername(input.username)
    patch.username_normalized = normalized
  }

  if (input.displayName !== undefined) patch.display_name = input.displayName.trim()
  if (input.planTag !== undefined) patch.plan_tag = input.planTag
  if (input.note !== undefined) patch.note = input.note
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl

  if (Object.keys(patch).length === 0 && roleChange === null) return before

  const apply = db.transaction(() => {
    if (Object.keys(patch).length > 0) usersRepo.update(db, targetId, patch, now)
    if (roleChange !== null) {
      // `actorId` is the human who made the grant; it is what the console renders
      // as "role granted by …". A system caller (CLI) leaves it NULL.
      usersRepo.grantRole(db, targetId, roleChange.roleId, actor.actorUserId ?? null, now)
    }
    if (patch.status === 'suspended' || patch.status === 'deleted') {
      sessionService.revokeAllForUser(targetId, REVOKE_REASON.suspended)
    }
  })
  apply()

  auditService.record(actor, {
    action: 'user.update',
    targetType: 'user',
    targetId,
    metadata: auditService.diff(
      {
        email: before.email_normalized,
        username: before.username_normalized,
        displayName: before.display_name,
        roleId: before.role_id,
        status: before.status,
        planTag: before.plan_tag,
      },
      {
        email: patch.email_normalized,
        username: patch.username_normalized,
        displayName: patch.display_name,
        roleId: roleChange?.roleId,
        status: patch.status,
        planTag: patch.plan_tag,
      },
    ),
  })

  if (roleChange !== null) {
    // Its own action because "who became what" is the question an incident
    // responder asks, and `user.update` buries it among plan-tag edits (§11).
    auditService.record(actor, {
      action: 'user.role_granted',
      targetType: 'user',
      targetId,
      metadata: {
        from: roleKeyOf(before.role_id),
        to: roleChange.roleKey,
        grantedBy: actor.actorUserId,
      },
    })
  }

  return getUser(targetId)
}

/** Soft delete; `hard` is owner-only and audited separately. */
export function deleteUser(
  actorId: string,
  targetId: string,
  options: { hard: boolean },
  actor: AuditContext,
): void {
  const db = getDb()
  const now = Date.now()
  const user = getUser(targetId)
  assertNotOwner(user, '删除')
  assertNotSelf(actorId, targetId, '删除')
  // INV-1. `deleteUser` is reachable from three places (DELETE, bulk, and the
  // PATCH status forward above), so the gate lives here rather than in a route.
  authorityService.assertRankAbove(actorId, targetId)

  // One transaction for revoke + tombstone + audit. The audit row is the ONLY
  // place the original email and username survive a soft delete (`restoreUser`
  // reads them back), so it cannot be best-effort: if the process dies between
  // the tombstone and the audit line, the account becomes permanently
  // unrecoverable. `auditService.record` swallows failures by design (losing a
  // log line must not fail a business write) — which is exactly why this path
  // inserts through the repository instead.
  const action = options.hard ? 'user.hard_delete' : 'user.delete'
  const metadata = { email: user.email_normalized, username: user.username_normalized }

  db.transaction(() => {
    sessionService.revokeAllForUser(targetId, REVOKE_REASON.deleted)
    if (options.hard) {
      usersRepo.hardDelete(db, targetId)
    } else {
      usersRepo.softDelete(db, targetId, now, `deleted+${targetId}@invalid`)
    }
    auditRepo.insert(db, {
      id: newId(),
      actorUserId: actor.actorUserId,
      actorLabel: actor.actorLabel,
      action,
      targetType: 'user',
      targetId,
      metadata,
      ip: actor.ip,
      requestId: actor.requestId,
      now,
    })
  })()
}

/**
 * Restore a soft-deleted user.
 *
 * The original address is recovered from the last `user.delete` audit row,
 * because the live row holds a tombstone. If the address has since been taken,
 * the caller gets `email_taken` and must choose a new one.
 */
export function restoreUser(targetId: string, actor: AuditContext): UserRow {
  const db = getDb()
  const now = Date.now()
  const user = getUser(targetId)
  if (user.status !== 'deleted') {
    throw new AppError(ERROR_CODE.conflict, '该用户未被删除')
  }
  // Invariant 1 covers restore as well: bringing a higher-ranked account back is a
  // weakening-adjacent action, and it is one of the seven entries review R-01
  // enumerated as previously ungated.
  authorityService.assertRankAbove(actor.actorUserId, targetId)

  const metadata = auditRepo.lastMetadataFor(db, 'user', targetId, 'user.delete')
  const email = typeof metadata?.email === 'string' ? metadata.email : ''
  const username = typeof metadata?.username === 'string' ? metadata.username : ''
  if (!email || !username) {
    throw new AppError(ERROR_CODE.conflict, '无法恢复：原始邮箱记录缺失，请手动指定新邮箱')
  }
  if (usersRepo.emailExists(db, email, targetId)) {
    throw new AppError(ERROR_CODE.emailTaken, '原邮箱已被其他账号占用，请先修改邮箱再恢复')
  }
  if (usersRepo.usernameExists(db, username, targetId)) {
    throw new AppError(ERROR_CODE.usernameTaken, '原用户名已被占用')
  }

  usersRepo.restore(db, targetId, now, email, username)
  auditService.record(actor, {
    action: 'user.restore',
    targetType: 'user',
    targetId,
    metadata: { email, username },
  })
  return getUser(targetId)
}

/** Clear lockout and failure counters so the user can try again immediately. */
export function unlockUser(targetId: string, actor: AuditContext): void {
  const db = getDb()
  const now = Date.now()
  const user = getUser(targetId)
  // Entry 6 of review R-01's list: clearing a lockout is a credential control
  // (it erases the exponential back-off), so the rank gate applies here too.
  authorityService.assertRankAbove(actor.actorUserId, targetId)
  usersRepo.clearFailedLogin(db, targetId, now)
  auditService.record(actor, {
    action: 'user.unlock',
    targetType: 'user',
    targetId,
    metadata: { wasLockedUntil: user.locked_until },
  })
}

export interface ResetPasswordResult {
  temporaryPassword: string
  expiresAt: string
}

/** Issue a temporary password and force a change at next sign-in. */
export async function resetUserPassword(
  targetId: string,
  actor: AuditContext,
): Promise<ResetPasswordResult> {
  const db = getDb()
  const now = Date.now()
  const user = getUser(targetId)
  assertNotOwner(user, '重置口令')
  /**
   * INV-1 — the single most direct account-takeover path before this feature.
   *
   * `resetUserPassword` guarded only against the owner, so an `admin` could issue a
   * temporary password for another `admin`, hand it over, and be that person —
   * no audit trail distinguishes it from routine support. Entry 3 of review R-01.
   */
  authorityService.assertRankAbove(actor.actorUserId, targetId)

  const temporaryPassword = newTempPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  usersRepo.update(
    db,
    targetId,
    {
      password_hash: passwordHash,
      password_updated_at: now,
      must_change_password: 1,
      failed_login_count: 0,
      lock_count: 0,
      locked_until: null,
    } as Partial<UserRow>,
    now,
  )
  sessionService.revokeAllForUser(targetId, REVOKE_REASON.passwordChanged)

  auditService.record(actor, {
    action: 'user.password_reset',
    targetType: 'user',
    targetId,
    metadata: { mode: 'temp_password' },
  })

  return {
    temporaryPassword,
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

export type BulkAction = 'suspend' | 'activate' | 'delete' | 'restore' | 'setRole'

/**
 * Why one row of a bulk run was skipped.
 *
 * A refusal from an authority gate carries `details.reason`, which is more precise
 * than the shared `forbidden` code and is what the console groups by. Anything else
 * falls back to its error code so an unexpected failure is still visible.
 */
function skipReason(error: unknown): string {
  if (!(error instanceof AppError)) return 'internal_error'
  const reason = error.details?.reason
  return typeof reason === 'string' && reason !== '' ? reason : error.code
}

export interface BulkResult {
  requested: number
  affected: string[]
  skipped: { id: string; reason: string }[]
}

/**
 * Bulk operations are all-or-nothing per user, not per batch: one owner row in
 * the selection must not abort the other nine. Each skip is reported back so
 * the console can show exactly what did and did not happen.
 */
export function bulk(
  actorId: string,
  input: { action: BulkAction; ids: string[]; roleId?: string },
  actor: AuditContext,
): BulkResult {
  const db = getDb()
  const rows = usersRepo.findIdsIn(db, input.ids)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const result: BulkResult = { requested: input.ids.length, affected: [], skipped: [] }

  for (const id of input.ids) {
    const user = byId.get(id)
    if (!user) {
      result.skipped.push({ id, reason: 'not_found' })
      continue
    }
    try {
      switch (input.action) {
        case 'suspend':
          updateUser(actorId, id, { status: 'suspended' }, actor)
          break
        case 'activate':
          updateUser(actorId, id, { status: 'active' }, actor)
          break
        case 'delete':
          deleteUser(actorId, id, { hard: false }, actor)
          break
        case 'restore':
          restoreUser(id, actor)
          break
        case 'setRole': {
          if (!input.roleId) throw new AppError(ERROR_CODE.validationFailed, '缺少 roleId')
          updateUser(actorId, id, { roleId: input.roleId }, actor)
          break
        }
      }
      result.affected.push(id)
    } catch (error) {
      result.skipped.push({
        id,
        // `details.reason` first: the authority gates answer `forbidden` with a
        // precise reason (`insufficient_rank`, `admin_allocation_reserved`), and
        // "forbidden" alone would make every refusal in a bulk run look identical
        // in the console's summary (AC-16c).
        reason: skipReason(error),
      })
    }
  }

  auditService.record(actor, {
    action: `user.bulk_${input.action}`,
    targetType: 'user',
    targetId: '',
    metadata: { affected: result.affected.length, skipped: result.skipped.length },
  })
  return result
}

/** Unlock every account whose lock has expired but whose counter is stale. */
export function sweepExpiredLocks(now = Date.now()): number {
  const db = getDb()
  const rows = db
    .prepare('SELECT id FROM users WHERE locked_until IS NOT NULL AND locked_until <= ?')
    .all(now) as { id: string }[]
  for (const row of rows) usersRepo.setLockedUntil(db, row.id, null, now)
  return rows.length
}
