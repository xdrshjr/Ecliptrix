import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as auditService from '@/server/services/auditService'
import * as sessionService from '@/server/services/sessionService'
import { maskIp } from '@/server/services/privacy'
import type { AuditContext } from '@/server/services/auditService'
import type { PageRequest } from '@/server/http/pagination'
import type { AuditRow, UserRow } from '@/server/db/types'

/**
 * Self-service (`/me/*`) data source.
 *
 * The rule that shapes this file: a normal user may read and change their own
 * presentation fields, and may revoke their own devices — nothing else. Email,
 * status, role and plan are administrator-owned, so they are not accepted by the
 * profile patch at all (rejected upstream as 422 by the strict schema).
 *
 * Address changes have their own two-confirmation flow
 * (`emailVerificationService`), and deletion has its own state machine
 * (`accountDeletionService`); this file only exposes them.
 */

export interface ProfileDto {
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null
  locale: string
  timezone: string
  planTag: string
  status: string
  mustChangePassword: boolean
  role: { id: string; key: string; name: string }
  createdAt: string
  lastLoginAt: string | null
  /** Added by migration 0005 — the desktop account centre reads these. */
  emailVerified: boolean
  emailVerifiedAt: string | null
  pendingEmail: string | null
  deletion: { status: 'awaiting_confirmation' | 'scheduled'; scheduledFor: string | null } | null
}

export function profile(userId: string): ProfileDto {
  const db = getDb()
  const user = usersRepo.findById(db, userId)
  if (!user) throw errors.unauthorized()
  const role = rolesRepo.findById(db, user.role_id)
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    locale: user.locale,
    timezone: user.timezone,
    planTag: user.plan_tag,
    status: user.status,
    mustChangePassword: user.must_change_password === 1,
    role: { id: role?.id ?? user.role_id, key: role?.key ?? 'member', name: role?.name ?? '成员' },
    createdAt: new Date(user.created_at).toISOString(),
    lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
    emailVerified: user.email_verified_at !== null,
    emailVerifiedAt: user.email_verified_at
      ? new Date(user.email_verified_at).toISOString()
      : null,
    pendingEmail: emailVerificationService.pendingEmail(user.id),
    deletion: accountDeletionService.liveForUser(user.id),
  }
}

export interface ProfilePatch {
  displayName?: string
  avatarUrl?: string | null
  locale?: string
  timezone?: string
}

/**
 * Apply a presentation patch.
 *
 * Refused while a deletion request is live (`409 deletion_pending`): editing an
 * account that is on its way out gives a false sense of "it is still mine", and
 * the same guard already protects the address change.
 */
export function updateProfile(userId: string, patch: ProfilePatch, actor: AuditContext): ProfileDto {
  const db = getDb()
  const before = usersRepo.findById(db, userId)
  if (!before) throw errors.unauthorized()

  if (accountDeletionService.liveForUser(userId)) {
    throw new AppError(ERROR_CODE.deletionPending, '注销申请进行中，暂不能修改资料')
  }

  const next: Partial<UserRow> = {}
  if (patch.displayName !== undefined) next.display_name = patch.displayName.trim()
  if (patch.avatarUrl !== undefined) next.avatar_url = patch.avatarUrl
  if (patch.locale !== undefined) next.locale = patch.locale
  if (patch.timezone !== undefined) next.timezone = patch.timezone

  if (Object.keys(next).length === 0) return profile(userId)

  usersRepo.update(db, userId, next, Date.now())
  auditService.record(actor, {
    action: 'user.profile_updated',
    targetType: 'user',
    targetId: userId,
    metadata: auditService.diff(
      {
        displayName: before.display_name,
        avatarUrl: before.avatar_url,
        locale: before.locale,
        timezone: before.timezone,
      },
      {
        displayName: next.display_name,
        avatarUrl: next.avatar_url,
        locale: next.locale,
        timezone: next.timezone,
      },
    ),
  })
  return profile(userId)
}

/**
 * Revoke one of my devices.
 *
 * A session id that belongs to somebody else answers `not_found`, never `403`:
 * a 403 would confirm the id exists, which is exactly the enumeration signal
 * `/me/*` must not provide.
 */
export function revokeMySession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
  actor: AuditContext,
): void {
  const db = getDb()
  const session = sessionsRepo.findById(db, sessionId)
  if (!session || session.user_id !== userId) throw errors.notFound('会话不存在')
  if (session.id === currentSessionId) {
    sessionService.revokeOne(sessionId, REVOKE_REASON.logout)
  } else {
    sessionService.revokeOne(sessionId, REVOKE_REASON.adminRevoked)
  }
  auditService.record(actor, {
    action: 'auth.session_revoked',
    targetType: 'session',
    targetId: sessionId,
    metadata: { self: true, device: session.device_name },
  })
}

export interface ActivityItemDto {
  id: string
  action: string
  targetType: string
  targetId: string
  /** The account holder's own address; only the web timeline renders it. */
  ip: string
  /** `1.2.x.x` — what the desktop forwards to the renderer. */
  ipMasked: string
  createdAt: string
}

/**
 * Activity timeline.
 *
 * `SELF_VISIBLE_ACTIONS` is the contract (see `auditRepo`): only actions a user is
 * allowed to know about themselves are returned, and every new self-service event
 * this release adds must be in that list — otherwise the tab exists but is empty.
 *
 * The DTO carries both `ip` (the account holder's own data, used by the web
 * timeline) and `ipMasked`. The desktop consumes the masked value only, so the
 * Electron renderer never receives a full address (spec §3.10 / P1-6).
 */
export function myActivity(
  userId: string,
  page: PageRequest,
): { rows: ActivityItemDto[]; total: number } {
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000
  const result = auditRepo.listForUser(getDb(), userId, since, page)
  return {
    total: result.total,
    rows: result.rows.map((row: AuditRow) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      ip: row.ip,
      ipMasked: maskIp(row.ip),
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
}

/**
 * File a deletion request.
 *
 * Delegated to `accountDeletionService`, which owns the state machine. Before
 * migration 0005 this only wrote an audit row — and it wrote the PLAINTEXT address
 * into `metadata`, which is exactly what the audit rule forbids. The delegation
 * removes both problems at once: real behaviour, masked metadata.
 */
export async function requestAccountDeletion(
  userId: string,
  input: { password: string; reason?: string },
  context: { ip: string; requestId: string; audit: AuditContext },
): Promise<accountDeletionService.DeletionRequestResult> {
  const db = getDb()
  const user = usersRepo.findById(db, userId)
  if (!user) throw errors.unauthorized()
  if (user.status === 'deleted') {
    throw new AppError(ERROR_CODE.conflict, '账号已注销')
  }
  // The password is the proof of ownership for a step the user cannot undo —
  // a stolen session alone must not be enough to close somebody's account.
  await accountDeletionService.assertPassword(user, input.password)
  return accountDeletionService.request(user, input, context)
}
