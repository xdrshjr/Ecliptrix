import { getDb } from '@/server/db/client'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import { maskEmail, maskIp, shortId } from '@/server/services/privacy'
import { REVOKE_REASON } from '@/server/auth/constants'
import { toIso } from '@/server/db/types'
import type { PageRequest } from '@/server/http/pagination'

/**
 * Global session administration.
 *
 * Deliberately separate from `sessionService`: the single-session operations there
 * answer `not_found` for an unknown id, which is the right contract for one row and
 * the wrong one for a bulk action (a stale row in the table must not fail the whole
 * selection). Here a miss is counted as `skipped`.
 */

export interface AdminSessionDto {
  id: string
  userId: string
  /** Masked: the console table must not become a bulk export of addresses. */
  userEmail: string
  userDisplayName: string
  client: string
  deviceName: string
  platform: string
  appVersion: string
  deviceKeyPrefix: string
  ip: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  revokedReason: string | null
  active: boolean
}

const ALLOWED_REASONS = new Set([
  REVOKE_REASON.adminRevoked,
  REVOKE_REASON.adminLockdown,
  REVOKE_REASON.securityIncident,
])

export function normaliseReason(value: string | undefined): string {
  const reason = (value ?? '').trim()
  return ALLOWED_REASONS.has(reason as never) ? reason : REVOKE_REASON.adminRevoked
}

export interface ListFilter {
  query?: string
  client?: string
  platform?: string
  activeOnly?: boolean
  sort: { column: sessionsRepo.SessionSortColumn; direction: 'ASC' | 'DESC' }
  page: PageRequest
}

export function listAll(filter: ListFilter, now = Date.now()): {
  rows: AdminSessionDto[]
  total: number
} {
  const result = sessionsRepo.listAll(getDb(), filter, now)
  return {
    total: result.total,
    rows: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userEmail: maskEmail(row.user_email),
      userDisplayName: row.user_display_name,
      client: row.client,
      deviceName: row.device_name,
      platform: row.platform,
      appVersion: row.app_version,
      deviceKeyPrefix: shortId(row.device_key),
      ip: maskIp(row.ip),
      createdAt: toIso(row.created_at),
      lastSeenAt: toIso(row.last_seen_at),
      revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
      revokedReason: row.revoked_reason,
      active: row.revoked_at === null && row.access_expires_at > now,
    })),
  }
}

/**
 * Bulk revoke.
 *
 * The cap (100) is enforced in the repository so a route cannot forget it, and the
 * caller writes ONE aggregated audit row — a single click that writes 100 audit
 * rows makes the log useless for exactly the investigation it exists for.
 */
export function revokeMany(
  ids: readonly string[],
  reasonInput: string | undefined,
  now = Date.now(),
): { revoked: number; skipped: number; reason: string } {
  const reason = normaliseReason(reasonInput)
  const result = sessionsRepo.revokeMany(getDb(), ids, now, reason)
  return { ...result, reason }
}
