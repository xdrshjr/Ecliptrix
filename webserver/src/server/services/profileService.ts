import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as auditService from '@/server/services/auditService'
import * as sessionService from '@/server/services/sessionService'
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
  }
}

export interface ProfilePatch {
  displayName?: string
  avatarUrl?: string | null
  locale?: string
  timezone?: string
}

export function updateProfile(userId: string, patch: ProfilePatch, actor: AuditContext): ProfileDto {
  const db = getDb()
  const before = usersRepo.findById(db, userId)
  if (!before) throw errors.unauthorized()

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

export function myActivity(userId: string, page: PageRequest): {
  rows: AuditRow[]
  total: number
} {
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000
  return auditRepo.listForUser(getDb(), userId, since, page)
}

/** Guard used by the console's DangerZone: record intent, change nothing. */
export function requestAccountDeletion(userId: string, actor: AuditContext): void {
  const db = getDb()
  const user = usersRepo.findById(db, userId)
  if (!user) throw errors.unauthorized()
  if (user.status === 'deleted') {
    throw new AppError(ERROR_CODE.conflict, '账号已注销')
  }
  auditService.record(actor, {
    action: 'user.deletion_requested',
    targetType: 'user',
    targetId: userId,
    metadata: { email: user.email_normalized },
  })
}
