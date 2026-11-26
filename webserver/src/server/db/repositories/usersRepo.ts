import type { Db } from '@/server/db/client'
import type { PageRequest } from '@/server/http/pagination'
import type { UserRow, UserStatus } from '@/server/db/types'
import { likeContains, likePrefix, placeholders, scalarCount, scalarCountNamed } from '@/server/db/repositories/shared'

/** Column whitelist for ORDER BY; anything else is rejected upstream. */
export const USER_SORT_COLUMNS = ['created_at', 'last_login_at', 'email', 'display_name'] as const
export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number]

export interface CreateUserInput {
  id: string
  email: string
  emailNormalized: string
  username: string
  usernameNormalized: string
  displayName: string
  passwordHash: string
  roleId: string
  status: UserStatus
  planTag: string
  mustChangePassword: boolean
  note?: string
  locale?: string
  timezone?: string
  now: number
  emailVerifiedAt?: number | null
  /**
   * Who granted the initial role (migration 0007). Omitted for the seeded root
   * administrator and for self-service registration, where the answer is
   * "the system" and is stored as NULL.
   */
  roleGrantedBy?: string | null
}

export interface UserListFilter {
  query?: string
  status?: UserStatus
  roleId?: string
  roleKey?: string
  plan?: string
  createdFrom?: number
  createdTo?: number
  sort: { column: UserSortColumn; direction: 'ASC' | 'DESC' }
  page: PageRequest
}

export interface UserListRow extends UserRow {
  role_key: string
  role_name: string
  sessions_active: number
  /**
   * The granting administrator's normalised address, joined for the detail page.
   *
   * Present only on rows produced by `SELECT_WITH_ROLE` (detail, list); a plain
   * `findById` row does not carry it. Null when the role came from the seed.
   */
  role_granted_by_label?: string | null
}

const COLUMNS = `u.id, u.email, u.email_normalized, u.username, u.username_normalized,
  u.display_name, u.password_hash, u.password_updated_at, u.role_id, u.status,
  u.plan_tag, u.must_change_password, u.email_verified_at, u.avatar_url, u.locale,
  u.timezone, u.note, u.last_login_at, u.failed_login_count, u.lock_count,
  u.locked_until, u.created_at, u.updated_at, u.deleted_at, u.last_exported_at,
  u.role_granted_by, u.role_granted_at`

const SELECT_WITH_ROLE = `SELECT ${COLUMNS}, r.key AS role_key, r.name AS role_name,
  (SELECT COUNT(*) FROM sessions s
     WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.access_expires_at > @now) AS sessions_active,
  g.email_normalized AS role_granted_by_label
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN users g ON g.id = u.role_granted_by`

/** Lookup used by login: one statement, one round trip, index-backed. */
export function findByEmailOrUsername(
  db: Db,
  emailNormalized: string,
  usernameNormalized: string,
): UserRow | undefined {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM users u
       WHERE u.email_normalized = ? OR u.username_normalized = ?
       LIMIT 1`,
    )
    .get(emailNormalized, usernameNormalized) as UserRow | undefined
}

export function findById(db: Db, id: string): UserRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM users u WHERE u.id = ?`).get(id) as UserRow | undefined
}

export function findDetailById(
  db: Db,
  id: string,
  now: number,
): (UserRow & { role_key: string; role_name: string; sessions_active: number }) | undefined {
  return db.prepare(`${SELECT_WITH_ROLE} WHERE u.id = @id`).get({ id, now }) as
    | (UserRow & { role_key: string; role_name: string; sessions_active: number })
    | undefined
}

export function emailExists(db: Db, emailNormalized: string, exceptId?: string): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM users WHERE email_normalized = ? AND id <> ? LIMIT 1')
    .get(emailNormalized, exceptId ?? '') as { hit: number } | undefined
  return Boolean(row)
}

export function usernameExists(db: Db, usernameNormalized: string, exceptId?: string): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1')
    .get(usernameNormalized, exceptId ?? '') as { hit: number } | undefined
  return Boolean(row)
}

export function create(db: Db, input: CreateUserInput): UserRow {
  db.prepare(
    `INSERT INTO users (
       id, email, email_normalized, username, username_normalized, display_name,
       password_hash, password_updated_at, role_id, status, plan_tag,
       must_change_password, email_verified_at, locale, timezone, note,
       role_granted_by, role_granted_at, created_at, updated_at
     ) VALUES (
       @id, @email, @emailNormalized, @username, @usernameNormalized, @displayName,
       @passwordHash, @now, @roleId, @status, @planTag,
       @mustChangePassword, @emailVerifiedAt, @locale, @timezone, @note,
       @roleGrantedBy, @roleGrantedAt, @now, @now
     )`,
  ).run({
    id: input.id,
    email: input.email,
    emailNormalized: input.emailNormalized,
    username: input.username,
    usernameNormalized: input.usernameNormalized,
    displayName: input.displayName,
    passwordHash: input.passwordHash,
    roleId: input.roleId,
    status: input.status,
    planTag: input.planTag,
    mustChangePassword: input.mustChangePassword ? 1 : 0,
    emailVerifiedAt: input.emailVerifiedAt ?? null,
    locale: input.locale ?? 'zh-CN',
    timezone: input.timezone ?? 'Asia/Shanghai',
    note: input.note ?? '',
    // A grant with no named actor (seeding, self-service registration) leaves the
    // pair NULL, which the console renders as "created by the system".
    roleGrantedBy: input.roleGrantedBy ?? null,
    roleGrantedAt: input.roleGrantedBy ? input.now : null,
    now: input.now,
  })
  const created = findById(db, input.id)
  if (!created) throw new Error(`user ${input.id} vanished immediately after insert`)
  return created
}

/**
 * Change a role and stamp the grant ledger in one statement.
 *
 * Separate from `update` because the two columns and `role_id` are one fact:
 * writing a role without its provenance is exactly the hole migration 0007
 * closes, and a generic partial patch makes that omission a one-line mistake.
 */
export function grantRole(db: Db, id: string, roleId: string, grantedBy: string | null, now: number): void {
  db.prepare(
    `UPDATE users
        SET role_id = @roleId, role_granted_by = @grantedBy,
            role_granted_at = @now, updated_at = @now
      WHERE id = @id`,
  ).run({ id, roleId, grantedBy, now })
}

/**
 * Field-level update. `undefined` means "leave alone" — the caller (service)
 * has already merged intent, so a partial patch cannot blank a column.
 */
export function update(db: Db, id: string, patch: Partial<UserRow>, now: number): void {
  const columns: string[] = []
  const values: Record<string, unknown> = { id, now }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    columns.push(`${key} = @${key}`)
    values[key] = value
  }
  if (columns.length === 0) return
  columns.push('updated_at = @now')
  db.prepare(`UPDATE users SET ${columns.join(', ')} WHERE id = @id`).run(values)
}

/**
 * Increment the failure counter and report the new value.
 *
 * The lock decision lives in the service, not here: the threshold is a runtime
 * setting (administrators can change it from the console), so baking it into
 * SQL would mean a schema-level read of `app_settings` on every failed login.
 */
export function bumpFailedLogin(
  db: Db,
  id: string,
  now: number,
): { count: number; lockCount: number } {
  const row = db
    .prepare(
      `UPDATE users
          SET failed_login_count = failed_login_count + 1,
              updated_at = @now
        WHERE id = @id
        RETURNING failed_login_count AS count, lock_count AS lockCount`,
    )
    .get({ id, now }) as { count: number; lockCount: number } | undefined
  return { count: row?.count ?? 0, lockCount: row?.lockCount ?? 0 }
}

/** Record one more lock episode (drives the exponential back-off). */
export function incrementLockCount(db: Db, id: string, now: number): number {
  const row = db
    .prepare(
      `UPDATE users SET lock_count = lock_count + 1, updated_at = @now
        WHERE id = @id RETURNING lock_count AS count`,
    )
    .get({ id, now }) as { count: number } | undefined
  return row?.count ?? 1
}

export function clearFailedLogin(db: Db, id: string, now: number): void {
  db.prepare(
    'UPDATE users SET failed_login_count = 0, lock_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
  ).run(now, id)
}

/** Reset the counter but keep `lock_count`, so back-off keeps escalating. */
export function clearFailedLoginCountOnly(db: Db, id: string, now: number): void {
  db.prepare(
    'UPDATE users SET failed_login_count = 0, updated_at = ? WHERE id = ?',
  ).run(now, id)
}

export function setLockedUntil(db: Db, id: string, lockedUntil: number | null, now: number): void {
  db.prepare('UPDATE users SET locked_until = ?, updated_at = ? WHERE id = ?').run(
    lockedUntil,
    now,
    id,
  )
}

export function markLoggedIn(db: Db, id: string, now: number): void {
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

/**
 * Soft delete. The unique email is rewritten so the address can be registered
 * again; the original lives on in the audit row written by the caller.
 */
export function softDelete(db: Db, id: string, now: number, tombstoneEmail: string): void {
  db.prepare(
    `UPDATE users
        SET status = 'deleted',
            deleted_at = @now,
            email_normalized = @tombstoneEmail,
            username_normalized = @tombstoneUsername,
            updated_at = @now
      WHERE id = @id`,
  ).run({ id, now, tombstoneEmail, tombstoneUsername: tombstoneEmail })
}

export function restore(
  db: Db,
  id: string,
  now: number,
  email: string,
  username: string,
): void {
  db.prepare(
    `UPDATE users
        SET status = 'active', deleted_at = NULL,
            email_normalized = @email, username_normalized = @username,
            updated_at = @now
      WHERE id = @id`,
  ).run({ id, now, email, username })
}

export function hardDelete(db: Db, id: string): void {
  // `app_settings.updated_by` is the only users reference that cannot be
  // neutralised by the delete itself when the database predates the SET NULL in
  // 0001_init.sql (SQLite cannot alter a foreign key in place, and rebuilding the
  // table would mean DROP — forbidden by the project's additive-only rule).
  // Clearing it here makes the hard delete work on old and new databases alike;
  // the statement is a no-op once the FK already does this.
  db.transaction(() => {
    db.prepare('UPDATE app_settings SET updated_by = NULL WHERE updated_by = ?').run(id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
}

export function countByStatus(db: Db): Record<string, number> {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM users GROUP BY status')
    .all() as { status: string; count: number }[]
  const out: Record<string, number> = {}
  for (const row of rows) out[row.status] = row.count
  return out
}

export function countAll(db: Db, sinceMs?: number): number {
  return sinceMs === undefined
    ? scalarCount(db, "SELECT COUNT(*) AS count FROM users WHERE status <> 'deleted'")
    : scalarCount(
        db,
        "SELECT COUNT(*) AS count FROM users WHERE status <> 'deleted' AND created_at >= ?",
        [sinceMs],
      )
}

/** Users that hold a given role — guards role deletion. */
export function countByRole(db: Db, roleId: string): number {
  return scalarCount(db, 'SELECT COUNT(*) AS count FROM users WHERE role_id = ?', [roleId])
}

export function idsByRole(db: Db, roleId: string): string[] {
  const rows = db.prepare('SELECT id FROM users WHERE role_id = ?').all(roleId) as { id: string }[]
  return rows.map((row) => row.id)
}

interface FilterSql {
  where: string
  params: Record<string, unknown>
}

function buildFilter(filter: Omit<UserListFilter, 'page' | 'sort'>, now: number): FilterSql {
  const clauses: string[] = []
  const params: Record<string, unknown> = { now }

  if (filter.query) {
    clauses.push(
      `(u.email LIKE @prefix ESCAPE '\\'
        OR u.username LIKE @prefix ESCAPE '\\'
        OR u.display_name LIKE @contains ESCAPE '\\')`,
    )
    params.prefix = likePrefix(filter.query)
    params.contains = likeContains(filter.query)
  }
  if (filter.status) {
    clauses.push('u.status = @status')
    params.status = filter.status
  } else {
    clauses.push("u.status <> 'deleted'")
  }
  if (filter.roleId) {
    clauses.push('u.role_id = @roleId')
    params.roleId = filter.roleId
  }
  if (filter.roleKey) {
    clauses.push('r.key = @roleKey')
    params.roleKey = filter.roleKey
  }
  if (filter.plan) {
    clauses.push('u.plan_tag = @plan')
    params.plan = filter.plan
  }
  if (filter.createdFrom !== undefined) {
    clauses.push('u.created_at >= @createdFrom')
    params.createdFrom = filter.createdFrom
  }
  if (filter.createdTo !== undefined) {
    clauses.push('u.created_at <= @createdTo')
    params.createdTo = filter.createdTo
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function list(db: Db, filter: UserListFilter, now: number): { rows: UserListRow[]; total: number } {
  const { where, params } = buildFilter(filter, now)
  // Qualified with `u.`: `roles` also has `created_at`, so a bare column name is
  // ambiguous after the join and SQLite refuses the statement.
  const orderBy = `u.${filter.sort.column} ${filter.sort.direction}`

  const total = scalarCountNamed(
    db,
    `SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id ${where}`,
    params,
  )
  const rows = db
    .prepare(`${SELECT_WITH_ROLE} ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.page.pageSize, offset: filter.page.offset }) as UserListRow[]
  return { rows, total }
}

/** Distinct ids for a bulk action, restricted to the caller's selection. */
export function findIdsIn(db: Db, ids: readonly string[]): UserRow[] {
  if (ids.length === 0) return []
  const statement = db.prepare(
    `SELECT ${COLUMNS} FROM users u WHERE u.id IN (${placeholders(ids.length)})`,
  )
  return statement.all(...ids) as UserRow[]
}

/** Lookup by address that does NOT hide soft-deleted rows (restore path). */
export function findByEmailIncludingDeleted(db: Db, emailNormalized: string): UserRow | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM users u WHERE u.email_normalized = ? LIMIT 1`)
    .get(emailNormalized) as UserRow | undefined
}

/** Stamp the export cooldown. See `accountExportService.cooldown`. */
export function touchLastExportedAt(db: Db, id: string, now: number): void {
  db.prepare('UPDATE users SET last_exported_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    id,
  )
}

/**
 * Rows for the console's CSV export.
 *
 * Shares the list filter so "export what I am looking at" is literally true, and
 * caps at `limit + 1` so the caller can tell "truncated" from "exactly full"
 * without a second count.
 */
export function listForExport(
  db: Db,
  filter: Omit<UserListFilter, 'page' | 'sort'>,
  limit: number,
  now: number,
): UserListRow[] {
  const { where, params } = buildFilter(filter, now)
  return db
    .prepare(
      `${SELECT_WITH_ROLE} ${where}
       ORDER BY u.created_at DESC LIMIT @limit`,
    )
    .all({ ...params, limit: limit + 1 }) as UserListRow[]
}
