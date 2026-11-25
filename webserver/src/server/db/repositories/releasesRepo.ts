import type { Db } from '@/server/db/client'
import type {
  ClientReleaseChannelRow,
  ClientReleaseRow,
  ClientReleaseStatus,
  ClientReleaseWithAuthorRow,
} from '@/server/db/types'

/**
 * Release catalogue persistence.
 *
 * SQL lives here and nowhere else. Two tables:
 *  - `client_releases`   — every artifact that was ever uploaded (the history)
 *  - `client_release_channels` — the pointer, one row per (channel, platform)
 *
 * `history` and `current` are deliberately different things: a rollback is a
 * pointer move, never a delete, so the build users already installed stays
 * downloadable.
 */

export interface NewReleaseRow {
  id: string
  version: string
  platform: string
  arch: string
  fileName: string
  storageKey: string
  byteSize: number
  sha256: string
  notes: string
  createdBy: string | null
  now: number
}

export function insert(db: Db, row: NewReleaseRow): void {
  db.prepare(
    `INSERT INTO client_releases
       (id, version, platform, arch, file_name, storage_key, byte_size, sha256, notes,
        status, downloads, created_by, created_at, published_at, retracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, NULL, NULL)`,
  ).run(
    row.id,
    row.version,
    row.platform,
    row.arch,
    row.fileName,
    row.storageKey,
    row.byteSize,
    row.sha256,
    row.notes,
    row.createdBy,
    row.now,
  )
}

export function findById(db: Db, id: string): ClientReleaseRow | undefined {
  return db.prepare('SELECT * FROM client_releases WHERE id = ?').get(id) as
    | ClientReleaseRow
    | undefined
}

export function findVersion(
  db: Db,
  version: string,
  platform: string,
  arch: string,
): ClientReleaseRow | undefined {
  return db
    .prepare(
      'SELECT * FROM client_releases WHERE version = ? AND platform = ? AND arch = ?',
    )
    .get(version, platform, arch) as ClientReleaseRow | undefined
}

/** Console list: drafts included, newest first, uploader address resolved. */
export function listWithAuthor(db: Db, limit = 200): ClientReleaseWithAuthorRow[] {
  return db
    .prepare(
      `SELECT r.*, u.email AS created_by_label
         FROM client_releases r
         LEFT JOIN users u ON u.id = r.created_by
        ORDER BY r.created_at DESC
        LIMIT ?`,
    )
    .all(limit) as ClientReleaseWithAuthorRow[]
}

/**
 * Public history for `/download`.
 *
 * `retracted` rows are included on purpose: a user whose installed build was
 * pulled still needs to fetch it again, and hiding it only sends them to support.
 */
export function listVisible(db: Db, limit = 50): ClientReleaseRow[] {
  return db
    .prepare(
      `SELECT * FROM client_releases
        WHERE status IN ('published', 'retracted')
        ORDER BY published_at DESC, created_at DESC
        LIMIT ?`,
    )
    .all(limit) as ClientReleaseRow[]
}

/** Release counts per status, for the console header and the overview tiles. */
export function countByStatus(db: Db): Record<ClientReleaseStatus, number> {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM client_releases GROUP BY status')
    .all() as { status: ClientReleaseStatus; count: number }[]
  const out: Record<ClientReleaseStatus, number> = { draft: 0, published: 0, retracted: 0 }
  for (const row of rows) out[row.status] = row.count
  return out
}

export function sumDownloads(db: Db): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(downloads), 0) AS total FROM client_releases')
    .get() as { total: number }
  return row.total
}

export function topDownloads(
  db: Db,
  limit = 5,
): { version: string; platform: string; downloads: number }[] {
  return db
    .prepare(
      `SELECT version, platform, downloads
         FROM client_releases
        WHERE downloads > 0
        ORDER BY downloads DESC, published_at DESC
        LIMIT ?`,
    )
    .all(limit) as { version: string; platform: string; downloads: number }[]
}

export function markPublished(db: Db, id: string, now: number): void {
  db.prepare(
    `UPDATE client_releases
        SET status = 'published', published_at = ?, retracted_at = NULL
      WHERE id = ?`,
  ).run(now, id)
}

export function markRetracted(db: Db, id: string, now: number): void {
  db.prepare("UPDATE client_releases SET status = 'retracted', retracted_at = ? WHERE id = ?").run(
    now,
    id,
  )
}

export function updateNotes(db: Db, id: string, notes: string): void {
  db.prepare('UPDATE client_releases SET notes = ? WHERE id = ?').run(notes, id)
}

export function incrementDownloads(db: Db, id: string): void {
  db.prepare('UPDATE client_releases SET downloads = downloads + 1 WHERE id = ?').run(id)
}

export function pointer(
  db: Db,
  channel: string,
  platform: string,
): ClientReleaseChannelRow | undefined {
  return db
    .prepare('SELECT * FROM client_release_channels WHERE channel = ? AND platform = ?')
    .get(channel, platform) as ClientReleaseChannelRow | undefined
}

export function listPointers(db: Db): ClientReleaseChannelRow[] {
  return db.prepare('SELECT * FROM client_release_channels ORDER BY channel, platform').all() as
    ClientReleaseChannelRow[]
}

/**
 * Move the pointer — ONE statement, so a concurrent publish/rollback cannot leave
 * the channel between two releases (single-writer SQLite makes this atomic).
 */
export function setPointer(
  db: Db,
  input: { channel: string; platform: string; releaseId: string | null; updatedBy: string | null; now: number },
): void {
  db.prepare(
    `INSERT INTO client_release_channels (channel, platform, release_id, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel, platform) DO UPDATE SET
       release_id = excluded.release_id,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(input.channel, input.platform, input.releaseId, input.now, input.updatedBy)
}

/** Clear every pointer aimed at one release (used when it is retracted). */
export function clearPointersFor(db: Db, releaseId: string, updatedBy: string | null, now: number): void {
  db.prepare(
    `UPDATE client_release_channels
        SET release_id = NULL, updated_at = ?, updated_by = ?
      WHERE release_id = ?`,
  ).run(now, updatedBy, releaseId)
}

/** Releases that are currently pointed at by any channel, keyed by release id. */
export function pointerTargets(db: Db): Map<string, { channel: string; platform: string }[]> {
  const rows = db
    .prepare('SELECT channel, platform, release_id FROM client_release_channels WHERE release_id IS NOT NULL')
    .all() as { channel: string; platform: string; release_id: string }[]
  const out = new Map<string, { channel: string; platform: string }[]>()
  for (const row of rows) {
    const list = out.get(row.release_id) ?? []
    list.push({ channel: row.channel, platform: row.platform })
    out.set(row.release_id, list)
  }
  return out
}

/**
 * Rows the channel currently points at.
 *
 * The join re-checks `status = 'published'` on purpose. `retract` clears the
 * pointer in the same transaction, and the FK is `ON DELETE SET NULL`, but neither
 * covers a hand-edited row — and `/download` advertising a build that the byte
 * endpoint then refuses is the kind of dead end this feature exists to remove.
 */
export function listCurrent(db: Db, channel: string): ClientReleaseRow[] {
  return db
    .prepare(
      `SELECT r.*
         FROM client_release_channels c
         JOIN client_releases r ON r.id = c.release_id
        WHERE c.channel = ? AND r.status = 'published'
        ORDER BY r.platform ASC`,
    )
    .all(channel) as ClientReleaseRow[]
}
