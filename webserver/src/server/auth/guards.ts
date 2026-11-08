import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as sessionService from '@/server/services/sessionService'
import * as auditService from '@/server/services/auditService'
import { hasPermission } from '@/server/auth/permissions'
import { ERROR_CODE, OWNER_ROLE_KEY, SESSION_COOKIE } from '@/server/auth/constants'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { AppError, errors } from '@/server/http/errors'
import { assertCsrf, readCookieFrom, type RequestContext } from '@/server/http/requestContext'
import type { SessionRow, UserRow } from '@/server/db/types'

/**
 * Authentication and authorisation guards.
 *
 * This is the authoritative layer (spec §2.2 rule 4). Edge middleware only checks
 * that a cookie exists; everything that decides *who* the caller is runs here,
 * in the Node runtime, against SQLite.
 */

export interface AuthContext {
  session: SessionRow
  user: UserRow
  role: { id: string; key: string; name: string }
  permissions: string[]
  /** Convenience for audit rows. */
  audit: auditService.AuditContext
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}

/** Access token from `Authorization: Bearer` first, then the session cookie. */
export function accessTokenFrom(request: Request): string | null {
  return bearerFrom(request) ?? readCookieFrom(request.headers, SESSION_COOKIE)
}

export function isBearerRequest(request: Request): boolean {
  return bearerFrom(request) !== null
}

/**
 * Resolve the caller, or return null when there is no usable session.
 *
 * Distinguishes the three "you are not in" cases the client must react to
 * differently: revoked, expired, suspended. All are `401` except suspension,
 * which is `403` so the desktop can show a ban message rather than a login form.
 */
export function resolveAuth(request: Request, context: RequestContext): AuthContext | null {
  const token = accessTokenFrom(request)
  if (!token) return null

  const session = sessionService.sessionFromAccessToken(token)
  if (!session) return null

  if (session.revoked_at !== null) {
    throw new AppError(ERROR_CODE.sessionRevoked, '会话已失效，请重新登录', {
      details: { reason: session.revoked_reason },
    })
  }
  if (session.access_expires_at <= Date.now()) {
    throw new AppError(ERROR_CODE.sessionExpired, '登录已过期，请重新登录')
  }

  const db = getDb()
  const user = usersRepo.findById(db, session.user_id)
  if (!user) throw errors.unauthorized()

  if (user.status === 'suspended') {
    throw new AppError(ERROR_CODE.accountSuspended, '账号已被停用，请联系管理员')
  }
  if (user.status !== 'active') {
    throw errors.unauthorized()
  }

  const role = rolesRepo.findById(db, user.role_id)
  const permissions = role ? rolesRepo.permissionsFor(db, role.id) : []

  return {
    session,
    user,
    role: { id: role?.id ?? user.role_id, key: role?.key ?? 'member', name: role?.name ?? '成员' },
    permissions,
    audit: {
      actorUserId: user.id,
      actorLabel: user.email,
      ip: context.ip,
      requestId: context.requestId,
    },
  }
}

/**
 * Require a session.
 *
 * `allowPasswordChangeRequired` is false by default: an account flagged
 * `must_change_password` can only reach the change-password endpoint, which is
 * what makes a temporary password genuinely temporary.
 */
export function requireSession(
  request: Request,
  context: RequestContext,
  options: { allowPasswordChangeRequired?: boolean } = {},
): AuthContext {
  const auth = resolveAuth(request, context)
  if (!auth) throw errors.unauthorized()
  if (auth.user.must_change_password === 1 && !options.allowPasswordChangeRequired) {
    throw new AppError(
      ERROR_CODE.passwordChangeRequired,
      '请先修改初始口令后再继续使用',
      { details: { redirectTo: '/account/security' } },
    )
  }
  return auth
}

/** Optional session: returns null instead of throwing (public pages). */
export function optionalSession(request: Request, context: RequestContext): AuthContext | null {
  try {
    return resolveAuth(request, context)
  } catch {
    return null
  }
}

/**
 * Require one permission.
 *
 * A denial is audited (`authz.denied`): a member probing `/admin` is a signal
 * worth keeping, and it is the only way the console can show "who tried".
 */
export function requirePermission(
  request: Request,
  context: RequestContext,
  permission: string,
): AuthContext {
  const auth = requireSession(request, context)
  if (!hasPermission(auth.permissions, permission)) {
    auditService.record(auth.audit, {
      action: 'authz.denied',
      targetType: 'permission',
      targetId: permission,
      metadata: { roleKey: auth.role.key },
    })
    throw new AppError(ERROR_CODE.forbidden, `缺少权限：${permission}`, {
      details: { required: permission },
    })
  }
  return auth
}

export function can(auth: AuthContext, permission: string): boolean {
  return hasPermission(auth.permissions, permission)
}

/**
 * Owner-only operations (`?hard=true` on delete and anything else irreversible).
 *
 * Enforced in the guards and not in the service because the service only sees an
 * `AuditContext`, which deliberately carries no identity — and because "who may
 * do this" belongs next to the other authorisation decisions.
 */
export function requireOwner(auth: AuthContext, action: string): void {
  if (auth.role.key !== OWNER_ROLE_KEY) {
    throw new AppError(ERROR_CODE.forbidden, `仅超级管理员可以${action}`, {
      details: { requiredRole: OWNER_ROLE_KEY },
    })
  }
}

/**
 * The standard guard for an admin write: permission, CSRF, then the budget.
 *
 * Order matters. Permission first means an unprivileged caller learns nothing
 * about the CSRF state. CSRF before the limiter means a cross-site forgery is
 * refused without spending the victim's budget. The limiter runs last so a burst
 * of legitimately-authenticated writes cannot be answered with `429` before the
 * authorisation decision is even made.
 *
 * Every admin write route uses this instead of assembling the three steps by
 * hand — one place to get right, and no route can quietly ship without CSRF
 * (which is exactly how `/unlock` lost it).
 */
export function requireAdminWrite(
  request: Request,
  context: RequestContext,
  permission: string,
): AuthContext {
  const auth = requirePermission(request, context, permission)
  if (!isBearerRequest(request)) assertCsrf(context)
  const limit = hit('admin:write', auth.user.id, LIMITS.adminWrite.limit, LIMITS.adminWrite.windowMs)
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)
  return auth
}

/**
 * The standard guard for an admin read: permission plus the `read:user` budget.
 *
 * Spec §4.6 budgets reads at 600/minute per user. Without it a script holding an
 * admin token can walk the whole user table and the audit log at line rate.
 */
export function requireAdminRead(
  request: Request,
  context: RequestContext,
  permission: string,
): AuthContext {
  const auth = requirePermission(request, context, permission)
  const limit = hit('read:user', auth.user.id, LIMITS.readUser.limit, LIMITS.readUser.windowMs)
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)
  return auth
}
