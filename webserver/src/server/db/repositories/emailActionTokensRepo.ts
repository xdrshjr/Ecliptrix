import type { Db } from '@/server/db/client'
import { scalarCount } from '@/server/db/repositories/shared'

/**
 * One-shot email tokens: address verification and change-of-address confirmation.
 *
 * The `(user_id, purpose) WHERE used_at IS NULL` partial unique index is the
 * invariant this module protects. Its predicate does NOT mention `expires_at`, so
 * an expired-but-unused row still occupies the slot; issuing must therefore
 * invalidate EVERY unused row — expired or not — inside the same transaction that
 * inserts the new one. Getting this backwards is a `SQLITE_CONSTRAINT_UNIQUE`
 * on the very ordinary "user clicks resend the next day" path.
 */

export type EmailActionPurpose = 'verify' | 'change_email'

export interface EmailActionTokenRow {
  id: string
  user_id: string
  purpose: EmailActionPurpose
  email_normalized: string
  token_hash: string
  expires_at: number
  used_at: number | null
  ip: string
  created_at: number
}

export interface IssueTokenInput {
  id: string
  userId: string
  purpose: EmailActionPurpose
  /** Target address for a change confirmation; '' for a plain verification. */
  emailNormalized: string
  tokenHash: string
  expiresAt: number
  ip: string
  now: number
}

/**
 * Retire every unused token of `(user, purpose)`, then insert the new one.
 *
 * Order is the whole point: invalidate first, insert second. Rows are never
 * deleted — an auditor wants to know when a link was voided — and the sweep in
 * `scripts/prune.ts` clears them after their retention window.
 */
export function issue(db: Db, input: IssueTokenInput): void {
  const run = db.transaction((value: IssueTokenInput) => {
    db.prepare(
      `UPDATE email_action_tokens SET used_at = @now
        WHERE user_id = @userId AND purpose = @purpose AND used_at IS NULL`,
    ).run({ now: value.now, userId: value.userId, purpose: value.purpose })
    db.prepare(
      `INSERT INTO email_action_tokens (
         id, user_id, purpose, email_normalized, token_hash, expires_at, ip, created_at
       ) VALUES (
         @id, @userId, @purpose, @emailNormalized, @tokenHash, @expiresAt, @ip, @now
       )`,
    ).run(value)
  })
  run(input)
}

export function findByHash(db: Db, tokenHash: string): EmailActionTokenRow | undefined {
  return db
    .prepare('SELECT * FROM email_action_tokens WHERE token_hash = ?')
    .get(tokenHash) as EmailActionTokenRow | undefined
}

export function findLive(
  db: Db,
  userId: string,
  purpose: EmailActionPurpose,
): EmailActionTokenRow | undefined {
  return db
    .prepare(
      `SELECT * FROM email_action_tokens
        WHERE user_id = ? AND purpose = ? AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId, purpose) as EmailActionTokenRow | undefined
}

/** Mark used; false when it was already consumed (a replay attempt). */
export function consume(db: Db, id: string, now: number): boolean {
  const result = db
    .prepare('UPDATE email_action_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(now, id)
  return result.changes === 1
}

/**
 * Void every unused token of one purpose.
 *
 * Cancelling a pending address change must not also kill an outstanding
 * `verify` link: the two are independent flows, and "I changed my mind about the
 * new address" should not silently invalidate the link the user still has in
 * their inbox for the address they already own.
 */
export function invalidateForUserPurpose(
  db: Db,
  userId: string,
  purpose: EmailActionPurpose,
  now: number,
): number {
  return db
    .prepare(
      'UPDATE email_action_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    )
    .run(now, userId, purpose).changes
}

/** Void every unused token of a user (account anonymisation, email change). */
export function invalidateAllForUser(db: Db, userId: string, now: number): number {
  return db
    .prepare('UPDATE email_action_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
    .run(now, userId).changes
}

/** Retention: used or expired rows older than the cutoff. */
export function pruneBefore(db: Db, cutoffMs: number): number {
  return db
    .prepare(
      `DELETE FROM email_action_tokens
        WHERE created_at < ? AND (used_at IS NOT NULL OR expires_at < ?)`,
    )
    .run(cutoffMs, cutoffMs).changes
}

export function countLive(db: Db, purpose: EmailActionPurpose): number {
  return scalarCount(
    db,
    'SELECT COUNT(*) AS count FROM email_action_tokens WHERE purpose = ? AND used_at IS NULL',
    [purpose],
  )
}
