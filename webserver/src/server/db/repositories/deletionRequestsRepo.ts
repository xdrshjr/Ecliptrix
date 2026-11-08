import type { Db } from '@/server/db/client'
import { scalarCount } from '@/server/db/repositories/shared'

/**
 * Account deletion requests.
 *
 * One row per request; a user may have history (cancelled requests stay). The
 * `idx_deletion_live` partial unique index allows at most one row in
 * `awaiting_confirmation` or `scheduled`, which is why `create()` cancels the
 * previous live row BEFORE inserting.
 *
 * `token_hash` is nullable by design: the no-SMTP degraded path never mails a
 * link, so there is no token to hash. Writing `''` there would make the second
 * degraded request collide on the unique index and answer 500.
 */

export type DeletionStatus = 'awaiting_confirmation' | 'scheduled' | 'cancelled' | 'completed'

export interface DeletionRequestRow {
  id: string
  user_id: string
  token_hash: string | null
  reason: string
  status: DeletionStatus
  requested_at: number
  confirmed_at: number | null
  scheduled_for: number | null
  cancelled_at: number | null
  completed_at: number | null
  ip: string
  request_id: string
}

export interface CreateDeletionInput {
  id: string
  userId: string
  tokenHash: string | null
  reason: string
  status: DeletionStatus
  scheduledFor: number | null
  ip: string
  requestId: string
  now: number
}

const LIVE_STATUSES: readonly DeletionStatus[] = ['awaiting_confirmation', 'scheduled']

/**
 * Cancel any live request of `userId`, then insert the new one.
 *
 * @returns the ids that were cancelled, so the caller can audit them.
 */
export function create(db: Db, input: CreateDeletionInput): string[] {
  const run = db.transaction((value: CreateDeletionInput) => {
    const live = db
      .prepare(
        `SELECT id FROM account_deletion_requests
          WHERE user_id = @userId
            AND status IN ('awaiting_confirmation', 'scheduled')`,
      )
      .all({ userId: value.userId }) as { id: string }[]
    db.prepare(
      `UPDATE account_deletion_requests
          SET status = 'cancelled', cancelled_at = @now
        WHERE user_id = @userId
          AND status IN ('awaiting_confirmation', 'scheduled')`,
    ).run({ userId: value.userId, now: value.now })
    db.prepare(
      `INSERT INTO account_deletion_requests (
         id, user_id, token_hash, reason, status, requested_at, scheduled_for,
         ip, request_id
       ) VALUES (
         @id, @userId, @tokenHash, @reason, @status, @now, @scheduledFor, @ip, @requestId
       )`,
    ).run(value)
    return live.map((row) => row.id)
  })
  return run(input)
}

export function findById(db: Db, id: string): DeletionRequestRow | undefined {
  return db
    .prepare('SELECT * FROM account_deletion_requests WHERE id = ?')
    .get(id) as DeletionRequestRow | undefined
}

export function findByTokenHash(db: Db, tokenHash: string): DeletionRequestRow | undefined {
  return db
    .prepare('SELECT * FROM account_deletion_requests WHERE token_hash = ?')
    .get(tokenHash) as DeletionRequestRow | undefined
}

export function findLiveByUser(db: Db, userId: string): DeletionRequestRow | undefined {
  return db
    .prepare(
      `SELECT * FROM account_deletion_requests
        WHERE user_id = ? AND status IN ('awaiting_confirmation', 'scheduled')
        ORDER BY requested_at DESC LIMIT 1`,
    )
    .get(userId) as DeletionRequestRow | undefined
}

export function listForUser(db: Db, userId: string): DeletionRequestRow[] {
  return db
    .prepare(
      'SELECT * FROM account_deletion_requests WHERE user_id = ? ORDER BY requested_at DESC',
    )
    .all(userId) as DeletionRequestRow[]
}

export function markScheduled(
  db: Db,
  id: string,
  input: { scheduledFor: number; now: number },
): void {
  // `token_hash = NULL` retires the mailed link in the same statement: the token
  // is single-use, and a replayable confirmation link lets anyone holding the old
  // mail postpone the deletion forever (each click recomputed now + grace).
  db.prepare(
    `UPDATE account_deletion_requests
        SET status = 'scheduled', confirmed_at = @now, scheduled_for = @scheduledFor,
            token_hash = NULL
      WHERE id = @id AND status IN ('awaiting_confirmation', 'scheduled')`,
  ).run({ id, now: input.now, scheduledFor: input.scheduledFor })
}

export function markCancelled(db: Db, id: string, now: number): void {
  db.prepare(
    `UPDATE account_deletion_requests
        SET status = 'cancelled', cancelled_at = @now
      WHERE id = @id AND status IN ('awaiting_confirmation', 'scheduled')`,
  ).run({ id, now })
}

export function markCompleted(db: Db, id: string, now: number): void {
  db.prepare(
    `UPDATE account_deletion_requests SET status = 'completed', completed_at = ?
      WHERE id = ?`,
  ).run(now, id)
}

/** Requests whose grace period has elapsed — the sweeper's work list. */
export function listDue(db: Db, now: number, limit: number): DeletionRequestRow[] {
  return db
    .prepare(
      `SELECT * FROM account_deletion_requests
        WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= ?
        ORDER BY scheduled_for ASC LIMIT ?`,
    )
    .all(now, limit) as DeletionRequestRow[]
}

export function countLive(db: Db): number {
  return scalarCount(
    db,
    `SELECT COUNT(*) AS count FROM account_deletion_requests
      WHERE status IN ('awaiting_confirmation', 'scheduled')`,
  )
}

export function findLiveById(db: Db, id: string): DeletionRequestRow | undefined {
  const row = findById(db, id)
  if (!row) return undefined
  return LIVE_STATUSES.includes(row.status) ? row : undefined
}
