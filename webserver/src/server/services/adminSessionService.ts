import { getDb } from '@/server/db/client'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as authorityService from '@/server/services/authorityService'
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
 *
 * ## Why the rank gate is here and not in the route
 *
 * Revoking a session does not change a row anyone can read later, but it removes a
 * person's ability to act — the same category as suspending them. `support`
 * (rank 40) holds `sessions.revoke` by design, so a route-level permission check
 * let a help-desk account force the root administrator (rank 100) offline
 * (review R-V4-02).
 *
 * The gate is evaluated **per id**, after resolving which account each session
 * belongs to, and it cannot abort the batch: the endpoint's contract is "partially
 * succeeded" — a stale row must not fail the whole selection, and by the same rule
 * a forbidden row must not either. Refused ids land in `denied` and the single
 * aggregated audit row counts them (review RV-7).
 *
 * `actorUserId` is REQUIRED, never defaulted to `null`: `null` means "the system"
 * and passes every gate, so a default would turn a forgotten argument into a
 * silent bypass — the one hole AC-19b exists to keep shut.
 */
export function revokeMany(
  ids: readonly string[],
  reasonInput: string | undefined,
  actorUserId: string | null,
  now = Date.now(),
): { revoked: number; skipped: number; denied: number; reason: string } {
  const reason = normaliseReason(reasonInput)
  const db = getDb()

  // Resolve ownership once per id, then split into "may revoke" and "may not".
  // A session whose row vanished belongs to the `skipped` bucket, exactly as it did
  // before the gate existed, so the console's "selected row went stale" behaviour
  // is unchanged.
  const allowed: string[] = []
  let denied = 0
  for (const id of new Set(ids.filter(Boolean))) {
    const session = sessionsRepo.findById(db, id)
    if (!session || session.revoked_at !== null) {
      allowed.push(id) // let the repository report it as skipped
      continue
    }
    if (authorityService.canRevokeSessionsOf(actorUserId, session.user_id)) {
      allowed.push(id)
    } else {
      denied += 1
    }
  }

  const result = sessionsRepo.revokeMany(db, allowed, now, reason)
  return { ...result, denied, reason }
}
