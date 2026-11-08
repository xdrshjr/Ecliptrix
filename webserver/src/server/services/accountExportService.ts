import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as deletionRepo from '@/server/db/repositories/deletionRequestsRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import * as invitesRepo from '@/server/db/repositories/invitesRepo'
import { ERROR_CODE } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as settingsService from '@/server/services/settingsService'
import * as auditService from '@/server/services/auditService'
import { maskIp, shortId } from '@/server/services/privacy'
import { toIso, type UserRow } from '@/server/db/types'
import type { AuditContext } from '@/server/services/auditService'

/**
 * "Take my data with me" export.
 *
 * Two properties matter more than completeness:
 *  - it contains NO credential material: no `password_hash`, no token digest, no
 *    refresh-reuse rows. A JSON file a user downloads and forgets belongs in their
 *    Downloads folder, not in a credential store;
 *  - the cooldown is driven by `users.last_exported_at`, not by an audit row.
 *    `auditService.record` is best-effort (it swallows failures) and audit rows
 *    are pruned by `audit.retentionDays`, so neither can be an authorisation
 *    input (P1-13).
 */

export const ACTIVITY_LIMIT = 5000

export interface AccountExport {
  format: 'ecliptrix.account.export'
  version: 1
  exportedAt: string
  account: {
    id: string
    email: string
    username: string
    displayName: string
    status: string
    planTag: string
    locale: string
    timezone: string
    emailVerifiedAt: string | null
    createdAt: string
    lastLoginAt: string | null
    role: { key: string; name: string }
  }
  sessions: {
    id: string
    client: string
    deviceName: string
    platform: string
    appVersion: string
    ipMasked: string
    createdAt: string
    lastSeenAt: string
    revokedAt: string | null
    revokedReason: string | null
  }[]
  activity: {
    action: string
    targetType: string
    targetId: string
    ipMasked: string
    createdAt: string
    metadata: Record<string, unknown>
  }[]
  invites: {
    created: { id: string; usedCount: number; createdAt: string; revokedAt: string | null }[]
  }
  deletion: { status: string; requestedAt: string; scheduledFor: string | null } | null
  truncated: { activity: boolean }
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Build the export document. Reads only; no writes (the route stamps the time). */
export function build(user: UserRow, now = Date.now()): AccountExport {
  const db = getDb()
  const role = rolesRepo.findById(db, user.role_id)

  const sessions = sessionsRepo.listForUser(db, user.id, true).map((row) => ({
    id: row.id,
    client: row.client,
    deviceName: row.device_name,
    platform: row.platform,
    appVersion: row.app_version,
    // The user's own addresses are still masked here: an export is a file that
    // travels, and the device list is not worth a travel log.
    ipMasked: maskIp(row.ip),
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    revokedReason: row.revoked_reason,
  }))

  // Repositories own the SQL; the service only assembles.
  const activity = auditRepo.listForExport(db, user.id, ACTIVITY_LIMIT)
  const truncated = activity.truncated

  // Only the invites this account issued, filtered in SQL. The previous version
  // selected the whole table, filtered in memory, and returned a hard-coded empty
  // `redeemed` list that read as "you redeemed none".
  const invites = invitesRepo.listByCreator(db, user.id)

  const deletion = deletionRepo.listForUser(db, user.id)[0]

  return {
    format: 'ecliptrix.account.export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    account: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      status: user.status,
      planTag: user.plan_tag,
      locale: user.locale,
      timezone: user.timezone,
      emailVerifiedAt: user.email_verified_at ? toIso(user.email_verified_at) : null,
      createdAt: toIso(user.created_at),
      lastLoginAt: user.last_login_at ? toIso(user.last_login_at) : null,
      role: { key: role?.key ?? 'member', name: role?.name ?? '成员' },
    },
    sessions,
    activity: activity.rows.map((row) => ({
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      ipMasked: maskIp(row.ip),
      createdAt: toIso(row.created_at),
      metadata: parseMetadata(row.metadata),
    })),
    invites: {
      // Codes are hashes in the database; only the ids are exportable, and only
      // the ones this account created. `usedCount` is the whole redemption story:
      // there is no redemption table, so a "which invites did I redeem" list cannot
      // be produced and inventing an empty one was worse than omitting it.
      created: invites.map((row) => ({
        id: row.id,
        usedCount: row.used_count,
        createdAt: toIso(row.created_at),
        revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
      })),
    },
    deletion: deletion
      ? {
          status: deletion.status,
          requestedAt: toIso(deletion.requested_at),
          scheduledFor: deletion.scheduled_for ? toIso(deletion.scheduled_for) : null,
        }
      : null,
    truncated: { activity: truncated },
  }
}

export interface ExportCooldown {
  allowed: boolean
  retryAfterSeconds: number
}

/** Cooldown probe: `users.last_exported_at` + the configured window. */
export function cooldown(user: UserRow, now = Date.now()): ExportCooldown {
  if (!user.last_exported_at) return { allowed: true, retryAfterSeconds: 0 }
  const windowMs = settingsService.getNumber('account.exportCooldownMinutes') * 60 * 1000
  const readyAt = user.last_exported_at + windowMs
  if (readyAt <= now) return { allowed: true, retryAfterSeconds: 0 }
  return { allowed: false, retryAfterSeconds: Math.ceil((readyAt - now) / 1000) }
}

/** Download filename: never a caller-supplied string, only sanitised id + date. */
export function fileName(user: UserRow, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  return `ecliptrix-account-${shortId(user.id)}-${stamp}.json`
}

/**
 * Build the export and stamp the cooldown.
 *
 * @throws {AppError} `rate_limited` with `details.retryAfterSeconds` while the
 *         cooldown is active.
 */
export function exportFor(
  user: UserRow,
  actor: AuditContext,
  now = Date.now(),
): { body: string; fileName: string } {
  const state = cooldown(user, now)
  if (!state.allowed) {
    throw new AppError(ERROR_CODE.rateLimited, '导出过于频繁，请稍后再试', {
      details: { retryAfterSeconds: state.retryAfterSeconds },
      retryAfterSeconds: state.retryAfterSeconds,
    })
  }

  const document = build(user, now)
  usersRepo.touchLastExportedAt(getDb(), user.id, now)
  auditService.record(actor, {
    action: 'user.exported',
    targetType: 'user',
    targetId: user.id,
    metadata: {
      activityRows: document.activity.length,
      sessions: document.sessions.length,
      truncated: document.truncated.activity,
    },
  })
  return { body: JSON.stringify(document, null, 2), fileName: fileName(user, now) }
}

export { errors }
