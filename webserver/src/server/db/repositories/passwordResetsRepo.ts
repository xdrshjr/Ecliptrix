import type { Db } from '@/server/db/client'
import type { PasswordResetRow } from '@/server/db/types'

/** One-time password reset tokens (self-service mail flow and console links). */

export function create(
  db: Db,
  input: {
    id: string
    userId: string
    tokenHash: string
    issuedBy: string | null
    expiresAt: number
    now: number
  },
): void {
  // Any earlier live token for this user is invalidated: only the newest link
  // may work, so a resend cannot leave two valid entry points in the wild.
  db.prepare(
    'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
  ).run(input.now, input.userId)
  db.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, issued_by, expires_at, created_at)
     VALUES (@id, @userId, @tokenHash, @issuedBy, @expiresAt, @now)`,
  ).run(input)
}

export function findByHash(db: Db, tokenHash: string): PasswordResetRow | undefined {
  return db
    .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?')
    .get(tokenHash) as PasswordResetRow | undefined
}

/** Mark used; returns false when it was already consumed (replay attempt). */
export function consume(db: Db, id: string, now: number): boolean {
  const result = db
    .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(now, id)
  return result.changes === 1
}

export function pruneExpired(db: Db, now: number): number {
  return db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').run(now).changes
}
