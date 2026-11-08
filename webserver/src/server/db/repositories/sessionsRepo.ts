import type { Db } from '@/server/db/client'
import type { SessionClient, SessionRow } from '@/server/db/types'
import { scalarCount } from '@/server/db/repositories/shared'

/**
 * Session storage.
 *
 * Nothing here ever sees a plaintext token: the service hashes first and passes
 * digests in. That is what keeps a database dump from being a credential dump.
 */

export interface CreateSessionInput {
  id: string
  userId: string
  client: SessionClient
  accessTokenHash: string
  refreshTokenHash: string
  deviceName: string
  platform: string
  appVersion: string
  ip: string
  userAgent: string
  now: number
  accessExpiresAt: number
  refreshExpiresAt: number
}

export function create(db: Db, input: CreateSessionInput): void {
  db.prepare(
    `INSERT INTO sessions (
       id, user_id, client, access_token_hash, refresh_token_hash,
       device_name, platform, app_version, ip, user_agent,
       created_at, last_seen_at, access_expires_at, refresh_expires_at
     ) VALUES (
       @id, @userId, @client, @accessTokenHash, @refreshTokenHash,
       @deviceName, @platform, @appVersion, @ip, @userAgent,
       @now, @now, @accessExpiresAt, @refreshExpiresAt
     )`,
  ).run(input)
}

export function findByAccessHash(db: Db, accessTokenHash: string): SessionRow | undefined {
  return db
    .prepare('SELECT * FROM sessions WHERE access_token_hash = ?')
    .get(accessTokenHash) as SessionRow | undefined
}

export function findByRefreshHash(db: Db, refreshTokenHash: string): SessionRow | undefined {
  return db
    .prepare('SELECT * FROM sessions WHERE refresh_token_hash = ?')
    .get(refreshTokenHash) as SessionRow | undefined
}

export function findById(db: Db, id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
}

export function touch(db: Db, id: string, now: number): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, id)
}

/**
 * Swap both token digests and extend the lifetimes in one statement, while
 * retiring the previous refresh digest into the history chain so a later
 * presentation of it can be recognised as reuse.
 */
export function rotate(
  db: Db,
  session: SessionRow,
  input: {
    accessTokenHash: string
    refreshTokenHash: string
    accessExpiresAt: number
    refreshExpiresAt: number
    now: number
  },
): void {
  const tx = db.transaction(() => {
    if (session.refresh_token_hash) {
      db.prepare(
        `INSERT OR IGNORE INTO refresh_token_history (token_hash, session_id, user_id, retired_at)
         VALUES (?, ?, ?, ?)`,
      ).run(session.refresh_token_hash, session.id, session.user_id, input.now)
    }
    db.prepare(
      `UPDATE sessions
          SET access_token_hash = @accessTokenHash,
              refresh_token_hash = @refreshTokenHash,
              access_expires_at = @accessExpiresAt,
              refresh_expires_at = @refreshExpiresAt,
              last_seen_at = @now
        WHERE id = @id`,
    ).run({ id: session.id, ...input })
  })
  tx()
}

/** A retired refresh digest, if this value was ever a live token. */
export function findRetiredRefreshHash(
  db: Db,
  tokenHash: string,
): { session_id: string; user_id: string } | undefined {
  return db
    .prepare('SELECT session_id, user_id FROM refresh_token_history WHERE token_hash = ?')
    .get(tokenHash) as { session_id: string; user_id: string } | undefined
}

export function revokeOne(db: Db, id: string, now: number, reason: string): void {
  db.prepare(
    `UPDATE sessions SET revoked_at = ?, revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,
  ).run(now, reason, id)
}

/** Returns the number of sessions actually revoked (idempotent). */
export function revokeAllForUser(
  db: Db,
  userId: string,
  now: number,
  reason: string,
  exceptSessionId?: string,
): number {
  const result = db
    .prepare(
      `UPDATE sessions SET revoked_at = @now, revoked_reason = @reason
        WHERE user_id = @userId AND revoked_at IS NULL AND id <> @except`,
    )
    .run({ now, reason, userId, except: exceptSessionId ?? '' })
  return result.changes
}

export function listForUser(db: Db, userId: string, includeRevoked = false): SessionRow[] {
  const where = includeRevoked ? '' : 'AND revoked_at IS NULL'
  return db
    .prepare(`SELECT * FROM sessions WHERE user_id = ? ${where} ORDER BY last_seen_at DESC`)
    .all(userId) as SessionRow[]
}

export function countActiveForUser(db: Db, userId: string, now: number): number {
  return scalarCount(
    db,
    `SELECT COUNT(*) AS count FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND access_expires_at > ?`,
    [userId, now],
  )
}

export function countActive(db: Db, now: number): number {
  return scalarCount(
    db,
    'SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL AND access_expires_at > ?',
    [now],
  )
}

/** Oldest active sessions beyond `keep`, used to enforce the per-user cap. */
export function oldestActiveIds(db: Db, userId: string, keep: number, now: number): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND access_expires_at > ?
        ORDER BY last_seen_at DESC
        LIMIT -1 OFFSET ?`,
    )
    .all(userId, now, Math.max(0, keep)) as { id: string }[]
  return rows.map((row) => row.id)
}

export function recordRefreshReuse(
  db: Db,
  input: {
    id: string
    sessionId: string
    userId: string
    ip: string
    userAgent: string
    now: number
  },
): void {
  db.prepare(
    `INSERT INTO refresh_token_reuse_events
       (id, session_id, user_id, presented_at, ip, user_agent, action_taken)
     VALUES (@id, @sessionId, @userId, @now, @ip, @userAgent, 'revoke_all_sessions')`,
  ).run(input)
}

export function countRefreshReuse(db: Db, userId: string): number {
  return scalarCount(
    db,
    'SELECT COUNT(*) AS count FROM refresh_token_reuse_events WHERE user_id = ?',
    [userId],
  )
}

/**
 * Retention for the retired-digest chain. Called from the boot prune so the
 * table cannot grow without bound on a long-lived deployment.
 */
export function pruneRefreshHistory(db: Db, cutoffMs: number): number {
  return db.prepare('DELETE FROM refresh_token_history WHERE retired_at < ?').run(cutoffMs).changes
}
