import type { Db } from '@/server/db/client'
import type { InviteRow } from '@/server/db/types'

/** Registration invites. Only the hash is stored; the code is shown once. */

export interface CreateInviteInput {
  id: string
  codeHash: string
  codeHint: string
  createdBy: string
  roleId: string
  maxUses: number
  expiresAt: number | null
  now: number
}

export interface InviteListRow extends InviteRow {
  role_key: string
  role_name: string
  created_by_label: string
}

export function create(db: Db, input: CreateInviteInput): void {
  db.prepare(
    `INSERT INTO registration_invites
       (id, code_hash, code_hint, created_by, role_id, max_uses, used_count,
        expires_at, created_at)
     VALUES (@id, @codeHash, @codeHint, @createdBy, @roleId, @maxUses, 0,
             @expiresAt, @now)`,
  ).run(input)
}

export function findByHash(db: Db, codeHash: string): InviteRow | undefined {
  return db
    .prepare('SELECT * FROM registration_invites WHERE code_hash = ?')
    .get(codeHash) as InviteRow | undefined
}

export function findById(db: Db, id: string): InviteRow | undefined {
  return db.prepare('SELECT * FROM registration_invites WHERE id = ?').get(id) as
    | InviteRow
    | undefined
}

export function listAll(db: Db): InviteListRow[] {
  return db
    .prepare(
      `SELECT i.*, r.key AS role_key, r.name AS role_name,
              COALESCE(u.display_name, u.username, 'system') AS created_by_label
         FROM registration_invites i
         JOIN roles r ON r.id = i.role_id
         LEFT JOIN users u ON u.id = i.created_by
        ORDER BY i.created_at DESC`,
    )
    .all() as InviteListRow[]
}

/**
 * The invites one account issued — the data-export feed.
 *
 * `used_count` is the only redemption signal the schema keeps: there is no
 * redemption table, so "which invite did I redeem" is not answerable and the
 * export must not pretend otherwise. Filtering happens in SQL, not in memory.
 */
export function listByCreator(
  db: Db,
  userId: string,
): { id: string; used_count: number; created_at: number; revoked_at: number | null }[] {
  return db
    .prepare(
      `SELECT id, used_count, created_at, revoked_at
         FROM registration_invites
        WHERE created_by = ?
        ORDER BY created_at DESC`,
    )
    .all(userId) as { id: string; used_count: number; created_at: number; revoked_at: number | null }[]
}

/**
 * Atomically consume one use.
 *
 * The WHERE clause carries the whole validity rule, so two concurrent
 * registrations cannot both win the last use: the second UPDATE matches zero
 * rows and the caller sees `changes === 0`.
 */
export function consume(db: Db, id: string, now: number): boolean {
  const result = db
    .prepare(
      `UPDATE registration_invites
          SET used_count = used_count + 1
        WHERE id = @id
          AND revoked_at IS NULL
          AND used_count < max_uses
          AND (expires_at IS NULL OR expires_at > @now)`,
    )
    .run({ id, now })
  return result.changes === 1
}

export function revoke(db: Db, id: string, now: number): void {
  db.prepare('UPDATE registration_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    now,
    id,
  )
}
