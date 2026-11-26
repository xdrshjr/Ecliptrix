import type { Db } from '@/server/db/client'
import type { LoginAttemptRow } from '@/server/db/types'

/** Login attempt telemetry: drives the lockout policy and the metrics panel. */

export function insert(
  db: Db,
  input: {
    id: string
    identifierNormalized: string
    ip: string
    success: boolean
    reason: string
    now: number
  },
): void {
  db.prepare(
    `INSERT INTO login_attempts (id, identifier_normalized, ip, success, reason, created_at)
     VALUES (@id, @identifierNormalized, @ip, @success, @reason, @now)`,
  ).run({ ...input, success: input.success ? 1 : 0 })
}

export function countFailuresSince(db: Db, identifierNormalized: string, sinceMs: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM login_attempts
        WHERE identifier_normalized = ? AND success = 0 AND created_at >= ?`,
    )
    .get(identifierNormalized, sinceMs) as { count: number }
  return row.count
}

/**
 * Failures from one source address since `sinceMs`.
 *
 * The second dimension of the captcha escalation (spec §3.2.4): the identifier
 * counter catches a targeted brute force, this one catches one machine walking a
 * list of accounts. `idx_attempts_ip` already exists, so the cost is an index
 * range scan on a table that only holds recent attempts.
 */
export function countFailuresByIpSince(db: Db, ip: string, sinceMs: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM login_attempts
        WHERE ip = ? AND success = 0 AND created_at >= ?`,
    )
    .get(ip, sinceMs) as { count: number }
  return row.count
}

export interface TopFailure {
  identifier: string
  failures: number
}

/** The five most-failed identifiers — an abused account or a typo storm. */
export function topFailedIdentifiers(db: Db, sinceMs: number, limit = 5): TopFailure[] {
  return db
    .prepare(
      `SELECT identifier_normalized AS identifier, COUNT(*) AS failures
         FROM login_attempts
        WHERE success = 0 AND created_at >= ?
        GROUP BY identifier_normalized
        ORDER BY failures DESC
        LIMIT ?`,
    )
    .all(sinceMs, limit) as TopFailure[]
}

export function listRecent(db: Db, identifierNormalized: string, limit = 20): LoginAttemptRow[] {
  return db
    .prepare(
      `SELECT * FROM login_attempts WHERE identifier_normalized = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(identifierNormalized, limit) as LoginAttemptRow[]
}

/** Retention: keep the table bounded without losing recent forensics. */
export function pruneOlderThan(db: Db, cutoffMs: number): number {
  return db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(cutoffMs).changes
}
