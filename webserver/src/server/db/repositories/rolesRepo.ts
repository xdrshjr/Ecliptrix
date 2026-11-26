import type { Db } from '@/server/db/client'
import type { RoleRow } from '@/server/db/types'
import { DEFAULT_CUSTOM_ROLE_RANK } from '@/server/auth/permissions'
import { scalarCount } from '@/server/db/repositories/shared'

/** Role storage plus the permission join table. */

export interface RoleWithPermissions extends RoleRow {
  permissions: string[]
  user_count: number
}

export function findById(db: Db, id: string): RoleRow | undefined {
  return db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined
}

export function findByKey(db: Db, key: string): RoleRow | undefined {
  return db.prepare('SELECT * FROM roles WHERE key = ?').get(key) as RoleRow | undefined
}

export function permissionsFor(db: Db, roleId: string): string[] {
  const rows = db
    .prepare('SELECT permission FROM role_permissions WHERE role_id = ?')
    .all(roleId) as { permission: string }[]
  return rows.map((row) => row.permission)
}

export function listAll(db: Db): RoleRow[] {
  return db.prepare('SELECT * FROM roles ORDER BY is_system DESC, key ASC').all() as RoleRow[]
}

/** Roles plus their permission set and user count — one page-load query set. */
export function listWithPermissions(db: Db): RoleWithPermissions[] {
  const roles = listAll(db)
  const permissionRows = db
    .prepare('SELECT role_id, permission FROM role_permissions')
    .all() as { role_id: string; permission: string }[]
  const counts = db
    .prepare('SELECT role_id, COUNT(*) AS count FROM users GROUP BY role_id')
    .all() as { role_id: string; count: number }[]

  const byRole = new Map<string, string[]>()
  for (const row of permissionRows) {
    const list = byRole.get(row.role_id) ?? []
    list.push(row.permission)
    byRole.set(row.role_id, list)
  }
  const countByRole = new Map(counts.map((row) => [row.role_id, row.count]))

  return roles.map((role) => ({
    ...role,
    permissions: byRole.get(role.id) ?? [],
    user_count: countByRole.get(role.id) ?? 0,
  }))
}

export function create(
  db: Db,
  input: {
    id: string
    key: string
    name: string
    description: string
    isSystem: boolean
    permissions: readonly string[]
    now: number
    /**
     * Authority level. Omitted for custom roles, which take
     * `DEFAULT_CUSTOM_ROLE_RANK` — the safe failure direction: a new role is never
     * born above its author.
     */
    rank?: number
  },
): void {
  db.prepare(
    `INSERT INTO roles (id, key, name, description, is_system, rank, created_at, updated_at)
     VALUES (@id, @key, @name, @description, @isSystem, @rank, @now, @now)`,
  ).run({
    id: input.id,
    key: input.key,
    name: input.name,
    description: input.description,
    isSystem: input.isSystem ? 1 : 0,
    // Imported rather than inlined: the migration's column default and this
    // fallback must agree, and a second literal is how they drift.
    rank: input.rank ?? DEFAULT_CUSTOM_ROLE_RANK,
    now: input.now,
  })
  replacePermissions(db, input.id, input.permissions)
}

export function update(
  db: Db,
  id: string,
  patch: { name?: string; description?: string },
  now: number,
): void {
  if (patch.name !== undefined) {
    db.prepare('UPDATE roles SET name = ?, updated_at = ? WHERE id = ?').run(patch.name, now, id)
  }
  if (patch.description !== undefined) {
    db.prepare('UPDATE roles SET description = ?, updated_at = ? WHERE id = ?').run(
      patch.description,
      now,
      id,
    )
  }
}

export function remove(db: Db, id: string): void {
  db.prepare('DELETE FROM roles WHERE id = ?').run(id)
}

/** Full replacement inside the caller's transaction. */
export function replacePermissions(db: Db, roleId: string, permissions: readonly string[]): void {
  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)',
  )
  for (const permission of permissions) insert.run(roleId, permission)
}

export function countAll(db: Db): number {
  return scalarCount(db, 'SELECT COUNT(*) AS count FROM roles')
}

export function userCount(db: Db, roleId: string): number {
  return scalarCount(db, 'SELECT COUNT(*) AS count FROM users WHERE role_id = ?', [roleId])
}

/**
 * Live-account counts per role key, for the security posture panel.
 *
 * Soft-deleted accounts are excluded: they are tombstones, and counting them would
 * make "how many administrators are there" answer higher than the number of people
 * an incident responder has to reason about.
 */
export function userCountsByRoleKey(db: Db): { key: string; count: number }[] {
  return db
    .prepare(
      `SELECT r.key AS key, COUNT(u.id) AS count
         FROM roles r LEFT JOIN users u ON u.role_id = r.id AND u.status <> 'deleted'
        GROUP BY r.id`,
    )
    .all() as { key: string; count: number }[]
}
