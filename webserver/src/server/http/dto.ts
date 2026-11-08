import type { InviteRow, UserRow } from '@/server/db/types'
import type { UserListRow } from '@/server/db/repositories/usersRepo'

/**
 * Wire shapes for the admin API.
 *
 * They live here rather than in `route.ts` files because Next.js validates the
 * export surface of a route module: anything that is not an HTTP method or a
 * route config is a build error.
 */

export function toAdminUserDto(row: UserListRow | (UserRow & { role_key?: string; role_name?: string; sessions_active?: number })): Record<string, unknown> {
  const roleKey = 'role_key' in row ? row.role_key : undefined
  const roleName = 'role_name' in row ? row.role_name : undefined
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: { id: row.role_id, key: roleKey ?? '', name: roleName ?? '' },
    status: row.status,
    planTag: row.plan_tag,
    note: row.note,
    mustChangePassword: row.must_change_password === 1,
    emailVerified: row.email_verified_at !== null,
    // The timestamp, not just the flag: an operator asking "when was this address
    // proven" cannot answer it from a boolean.
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    activeSessions: 'sessions_active' in row ? (row.sessions_active ?? 0) : 0,
    locked: row.locked_until !== null && row.locked_until > Date.now(),
  }
}

export function toAdminInviteDto(row: InviteRow & {
  role_key?: string
  role_name?: string
  created_by_label?: string
}): Record<string, unknown> {
  return {
    id: row.id,
    codeHint: row.code_hint,
    roleKey: row.role_key ?? '',
    roleName: row.role_name ?? '',
    createdByLabel: row.created_by_label ?? '',
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}
