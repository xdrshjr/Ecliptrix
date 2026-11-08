import type { Db } from '@/server/db/client'
import type { AuditRow } from '@/server/db/types'
import type { PageRequest } from '@/server/http/pagination'
import { likeContains } from '@/server/db/repositories/shared'
import { scalarCount, scalarCountNamed } from '@/server/db/repositories/shared'

/**
 * Append-only audit log.
 *
 * There is no update and no delete function here on purpose: the only supported
 * way to shrink this table is an operator running SQL under an explicit
 * retention policy (README §运维). Code that could rewrite history would make
 * every downstream investigation untrustworthy.
 */

export interface RecordAuditInput {
  id: string
  actorUserId: string | null
  actorLabel: string
  action: string
  targetType: string
  targetId: string
  metadata: Record<string, unknown>
  ip: string
  requestId: string
  now: number
}

export function insert(db: Db, input: RecordAuditInput): void {
  db.prepare(
    `INSERT INTO audit_events
       (id, actor_user_id, actor_label, action, target_type, target_id,
        metadata, ip, request_id, created_at)
     VALUES (@id, @actorUserId, @actorLabel, @action, @targetType, @targetId,
             @metadata, @ip, @requestId, @now)`,
  ).run({ ...input, metadata: JSON.stringify(input.metadata ?? {}) })
}

export interface AuditFilter {
  actorUserId?: string
  action?: string
  targetType?: string
  targetId?: string
  from?: number
  to?: number
  query?: string
}

export function list(
  db: Db,
  filter: AuditFilter,
  page: PageRequest,
): { rows: AuditRow[]; total: number } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}

  if (filter.actorUserId) {
    clauses.push('actor_user_id = @actorUserId')
    params.actorUserId = filter.actorUserId
  }
  if (filter.action) {
    // Prefix match so `user.*` and `user.` both work from the console filter.
    if (filter.action.endsWith('*')) {
      clauses.push('action LIKE @actionPrefix')
      params.actionPrefix = filter.action.slice(0, -1) + '%'
    } else {
      clauses.push('action = @action')
      params.action = filter.action
    }
  }
  if (filter.targetType) {
    clauses.push('target_type = @targetType')
    params.targetType = filter.targetType
  }
  if (filter.targetId) {
    clauses.push('target_id = @targetId')
    params.targetId = filter.targetId
  }
  if (filter.query) {
    clauses.push('(actor_label LIKE @query OR action LIKE @query OR target_id LIKE @query)')
    params.query = likeContains(filter.query)
  }
  if (filter.from !== undefined) {
    clauses.push('created_at >= @from')
    params.from = filter.from
  }
  if (filter.to !== undefined) {
    clauses.push('created_at <= @to')
    params.to = filter.to
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = scalarCountNamed(db, `SELECT COUNT(*) AS count FROM audit_events ${where}`, params)
  const rows = db
    .prepare(
      `SELECT * FROM audit_events ${where} ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: page.pageSize, offset: page.offset }) as AuditRow[]
  return { rows, total }
}

/** Whitelisted actions a normal user may see about themselves. */
export const SELF_VISIBLE_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.session_revoked',
  // Same-device re-login revokes the user's *own* older session; without this
  // the timeline cannot explain the "you were signed out" the desktop shows.
  'auth.session_relogin',
  'user.register',
  'user.profile_updated',
  'authz.denied',
  /**
   * Account-lifecycle actions (migration 0005).
   *
   * This array is the entire contract of `/me/activity`: the query is
   * `action IN (…)`, so an action missing here is invisible no matter how many
   * rows it wrote. The whole email/export/deletion feature set would therefore
   * ship "working but blank", and no existing test would go red — which is exactly
   * the defect this block fixes. Anything self-service belongs here; anything
   * administrative (bulk revoke, CSV export, settings) must NOT.
   */
  'auth.email_verified',
  'auth.email_verify_resent',
  'auth.email_verify_blocked_login',
  'user.email_change_requested',
  'user.email_change_cancelled',
  'user.email_changed',
  'user.email_verified_by_admin',
  'user.exported',
  // `user.deletion_requested` stays for historical rows written before 0005.
  'user.deletion_requested',
  'account.deletion_requested',
  'account.deletion_scheduled',
  'account.deletion_cancelled',
  'account.deletion_confirmed_by_admin',
  'account.deleted',
] as const

export function listForUser(
  db: Db,
  userId: string,
  sinceMs: number,
  page: PageRequest,
): { rows: AuditRow[]; total: number } {
  const placeholders = SELF_VISIBLE_ACTIONS.map(() => '?').join(', ')
  const args = [userId, userId, sinceMs, ...SELF_VISIBLE_ACTIONS]
  // The ownership predicate MUST stay parenthesised: `AND` binds tighter than
  // `OR`, so without the parentheses the actor branch escapes both the 90-day
  // window and the action allowlist and `/me/activity` returns the caller's
  // entire history — including `role.*` and `settings.update` rows they must
  // never see. Both statements share one `where` so count and page cannot drift.
  const where = `WHERE (actor_user_id = ? OR (target_type = 'user' AND target_id = ?))
        AND created_at >= ? AND action IN (${placeholders})`
  const total = scalarCount(db, `SELECT COUNT(*) AS count FROM audit_events ${where}`, args)
  const rows = db
    .prepare(
      `SELECT * FROM audit_events ${where}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, page.pageSize, page.offset) as AuditRow[]
  return { rows, total }
}

/**
 * Every event a user is the actor or the target of — the data-export feed.
 *
 * Deliberately NOT `listForUser`: that one is the console's self-service
 * timeline, windowed to 90 days and filtered by the `SELF_VISIBLE_ACTIONS`
 * allowlist. An export must hand back the account holder's own history in full,
 * which is the one case where the allowlist is the wrong instrument.
 */
export function listForExport(
  db: Db,
  userId: string,
  limit: number,
): { rows: AuditRow[]; truncated: boolean } {
  const rows = db
    .prepare(
      `SELECT * FROM audit_events
        WHERE (actor_user_id = ? OR (target_type = 'user' AND target_id = ?))
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, userId, limit + 1) as AuditRow[]
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

/** Last recorded metadata for a target+action — used to restore a soft delete. */
export function lastMetadataFor(
  db: Db,
  targetType: string,
  targetId: string,
  action: string,
): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT metadata FROM audit_events
        WHERE target_type = ? AND target_id = ? AND action = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(targetType, targetId, action) as { metadata: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.metadata) as Record<string, unknown>
  } catch {
    return null
  }
}

export function countForAction(db: Db, action: string, sinceMs: number): number {
  return scalarCount(
    db,
    'SELECT COUNT(*) AS count FROM audit_events WHERE action = ? AND created_at >= ?',
    [action, sinceMs],
  )
}
