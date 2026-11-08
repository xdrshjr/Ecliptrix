import { api } from '@/lib/api/client'

/**
 * Typed endpoint accessors.
 *
 * The paths live here so a console feature never spells
 * `/api/v1/admin/users/${id}` by hand: a typo inside a template string is a 404
 * the compiler cannot see, and a path change becomes one edit instead of a grep.
 *
 * Only endpoints the UI actually calls are listed — an unused accessor is dead
 * code pretending to be an API surface.
 */

const BASE = '/api/v1'

export interface SessionDto {
  id: string
  client: string
  deviceName: string
  platform: string
  ip: string
  lastSeenAt: string
  current: boolean
}

export interface AdminUserDto {
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null
  role: { id: string; key: string; name: string }
  status: string
  planTag: string
  note: string
  mustChangePassword: boolean
  emailVerified: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  activeSessions: number
  locked: boolean
}

export interface RoleOption {
  id: string
  key: string
  name: string
}

/** PATCH/POST body for a user — every field optional, the server merges. */
export interface UserPatchBody {
  email?: string
  username?: string
  displayName?: string
  roleId?: string
  status?: string
  planTag?: string
  note?: string
}

export interface BulkBody {
  action: 'suspend' | 'activate' | 'delete' | 'restore' | 'setRole'
  ids: string[]
  roleId?: string
}

export const usersApi = {
  create: (body: UserPatchBody) =>
    api.post<{ user: AdminUserDto; temporaryPassword: string | null }>(`${BASE}/admin/users`, body),
  update: (id: string, body: UserPatchBody) =>
    api.patch<{ user: AdminUserDto }>(`${BASE}/admin/users/${id}`, body),
  remove: (id: string, hard = false) =>
    api.delete<{ deleted: boolean; hard: boolean }>(
      `${BASE}/admin/users/${id}${hard ? '?hard=true' : ''}`,
    ),
  restore: (id: string) =>
    api.post<{ restored: boolean; user: AdminUserDto }>(`${BASE}/admin/users/${id}/restore`),
  unlock: (id: string) =>
    api.post<{ unlocked: boolean; userId: string }>(`${BASE}/admin/users/${id}/unlock`),
  resetPassword: (id: string) =>
    api.post<{ temporaryPassword: string | null; expiresAt: string; mustChangePassword: boolean }>(
      `${BASE}/admin/users/${id}/password-reset`,
      { mode: 'temp_password' },
    ),
  bulk: (body: BulkBody) =>
    api.post<{ requested: number; affected: string[]; skipped: { id: string; reason: string }[] }>(
      `${BASE}/admin/users/bulk`,
      body,
    ),
}

export const sessionsApi = {
  /** Admin revoke — any session of any user. */
  revokeForUser: (sessionId: string) =>
    api.delete<{ revoked: boolean }>(`${BASE}/admin/sessions/${sessionId}`),
  /** Self-service revoke — another user's session answers 404 by design. */
  revokeMine: (sessionId: string) =>
    api.delete<{ revoked: boolean }>(`${BASE}/me/sessions/${sessionId}`),
}

export const meApi = {
  requestDeletion: () => api.post<{ requested: boolean }>(`${BASE}/me/deletion-request`),
}
