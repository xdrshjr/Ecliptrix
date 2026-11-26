import type { Db } from '@/server/db/client'
import type { CaptchaChallengeRow, CaptchaPurpose } from '@/server/db/types'

/**
 * Human-verification challenge storage (migration 0007).
 *
 * The single place SQL for `captcha_challenges` is written. Two properties are
 * load-bearing and are why they live here rather than in the service:
 *
 *  - `consume` is an atomic conditional UPDATE. Two concurrent requests holding
 *    the same id can only produce one `changes === 1`, which is the whole of
 *    invariant DM-1. A read-then-write in the service would race.
 *  - nothing here ever handles a plaintext answer. The caller hashes, this stores.
 */

export function insert(
  db: Db,
  input: {
    id: string
    purpose: CaptchaPurpose
    answerHash: string
    ip: string
    maxAttempts: number
    expiresAt: number
    now: number
  },
): void {
  db.prepare(
    `INSERT INTO captcha_challenges
       (id, purpose, answer_hash, ip, attempts, max_attempts, expires_at, consumed_at, created_at)
     VALUES (@id, @purpose, @answerHash, @ip, 0, @maxAttempts, @expiresAt, NULL, @now)`,
  ).run(input)
}

export function findById(db: Db, id: string): CaptchaChallengeRow | undefined {
  return db.prepare('SELECT * FROM captcha_challenges WHERE id = ?').get(id) as
    | CaptchaChallengeRow
    | undefined
}

/**
 * Mark a challenge used, exactly once.
 *
 * @returns true when this call won the race (one row changed). `false` means the
 *          id was already consumed — callers must treat that as `captcha_invalid`,
 *          never as a retry.
 */
export function consume(db: Db, id: string, now: number): boolean {
  const result = db
    .prepare(
      'UPDATE captcha_challenges SET consumed_at = @now WHERE id = @id AND consumed_at IS NULL',
    )
    .run({ id, now })
  return result.changes === 1
}

/** Record one wrong answer; returns the new attempt count. */
export function bumpAttempts(db: Db, id: string): number {
  const row = db
    .prepare(
      `UPDATE captcha_challenges SET attempts = attempts + 1
        WHERE id = @id RETURNING attempts`,
    )
    .get({ id }) as { attempts: number } | undefined
  return row?.attempts ?? 0
}

/**
 * Retention: drop challenges that are long dead.
 *
 * Both conditions are ORed because a challenge can be spent early (consumed) or
 * abandoned (expired), and each kind becomes garbage at a different moment.
 */
export function pruneBefore(db: Db, cutoffMs: number): number {
  return db
    .prepare(
      `DELETE FROM captcha_challenges
        WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    )
    .run(cutoffMs, cutoffMs).changes
}

/** Issued/solved/rejected counts for the security posture panel. */
export interface CaptchaWindowCounts {
  issued: number
  solved: number
  failed: number
}

/**
 * How many challenges in the window came from an untrustworthy address.
 *
 * `clientIpFrom` answers the constant `0.0.0.0` when no trusted forwarder header
 * arrived, so a high share here means every per-IP budget in this deployment is
 * really one site-wide budget (review R-02). The panel surfaces it as a
 * configuration warning rather than a security metric.
 */
export function untrustedIssueCounts(
  db: Db,
  fallbackIp: string,
  sinceMs: number,
): { issued: number; untrusted: number } {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS issued,
         SUM(CASE WHEN ip = ? THEN 1 ELSE 0 END) AS untrusted
       FROM captcha_challenges
       WHERE created_at >= ?`,
    )
    .get(fallbackIp, sinceMs) as { issued: number | null; untrusted: number | null }
  return { issued: row?.issued ?? 0, untrusted: row?.untrusted ?? 0 }
}

/**
 * Count challenge outcomes inside a window.
 *
 * Derived without a status column on purpose: `consumed_at IS NOT NULL` is the
 * success state and the only way a row becomes consumed is a correct answer, so
 * no extra bookkeeping has to be kept honest. `failed` counts rows abandoned with
 * at least one wrong attempt — those are the ones the gate actually stopped.
 */
export function windowCounts(db: Db, sinceMs: number): CaptchaWindowCounts {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= @since THEN 1 ELSE 0 END) AS issued,
         SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS solved,
         SUM(CASE WHEN consumed_at IS NULL AND attempts > 0 THEN 1 ELSE 0 END) AS failed
       FROM captcha_challenges
       WHERE created_at >= @since`,
    )
    .get({ since: sinceMs }) as { issued: number | null; solved: number | null; failed: number | null }
  return {
    issued: row?.issued ?? 0,
    solved: row?.solved ?? 0,
    failed: row?.failed ?? 0,
  }
}
