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
  appVersion: string
  /** Stable per-machine fingerprint; the console shows its first 8 characters. */
  deviceKey: string
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
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
  emailVerifiedAt: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  activeSessions: number
  locked: boolean
  /**
   * Grant ledger: who handed this account its current role, and when.
   *
   * Null means "the system created it" (the seeded root administrator), which the
   * detail page renders as such rather than as a blank field. It survives audit
   * pruning on purpose — `audit_events` is retention-bounded, this pair is not.
   */
  roleGrantedBy: { id: string; label: string } | null
  roleGrantedAt: string | null
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
  /** Mark an address verified on behalf of a user who cannot receive mail. */
  markEmailVerified: (id: string) =>
    api.post<{ emailVerifiedAt: string }>(`${BASE}/admin/users/${id}/email-verify`),
  /** Confirm a pending deletion for a user who lost access to the mailbox. */
  confirmDeletion: (id: string, reason: string) =>
    api.post<{ status: string; scheduledFor: string }>(`${BASE}/admin/users/${id}/deletion`, {
      reason,
    }),
  bulk: (body: BulkBody) =>
    api.post<{ requested: number; affected: string[]; skipped: { id: string; reason: string }[] }>(
      `${BASE}/admin/users/bulk`,
      body,
    ),
}

export interface AdminSessionRow {
  id: string
  userId: string
  userEmail: string
  userDisplayName: string
  client: string
  deviceName: string
  platform: string
  appVersion: string
  deviceKeyPrefix: string
  ip: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  revokedReason: string | null
  active: boolean
}

export const sessionsApi = {
  /** Admin revoke — any session of any user. */
  revokeForUser: (sessionId: string) =>
    api.delete<{ revoked: boolean }>(`${BASE}/admin/sessions/${sessionId}`),
  /** Self-service revoke — another user's session answers 404 by design. */
  revokeMine: (sessionId: string) =>
    api.delete<{ revoked: boolean }>(`${BASE}/me/sessions/${sessionId}`),
  /** Global list with URL-driven filters. */
  list: (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString()
    return api.get<{ rows: AdminSessionRow[]; total: number }>(
      `${BASE}/admin/sessions${search ? `?${search}` : ''}`,
    )
  },
  revokeMany: (ids: string[], reason: string) =>
    // `denied` is separate from `skipped` on purpose: "the row was already gone"
    // and "you are not allowed to kick that account" need different words, and
    // collapsing them would tell an operator a refusal was a stale selection.
    api.post<{ revoked: number; skipped: number; denied: number }>(
      `${BASE}/admin/sessions/revoke`,
      { ids, reason },
    ),
}

export interface MailRow {
  id: string
  template: string
  toMasked: string
  status: 'captured' | 'sent' | 'failed'
  attempts: number
  retryable: boolean
  lastError: string
  createdAt: string
  sentAt: string | null
}

export const mailApi = {
  list: (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString()
    return api.get<{ rows: MailRow[]; total: number }>(
      `${BASE}/admin/mail${search ? `?${search}` : ''}`,
    )
  },
  detail: (id: string) =>
    api.get<MailRow & { subject: string; text: string }>(`${BASE}/admin/mail/${id}`),
  retry: (id: string) =>
    api.post<{ id: string; status: string; attempts: number; lastError: string }>(
      `${BASE}/admin/mail/${id}/retry`,
    ),
}

export interface MeProfileDto {
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null
  locale: string
  timezone: string
  planTag: string
  status: string
  mustChangePassword: boolean
  role: { id: string; key: string; name: string }
  createdAt: string
  lastLoginAt: string | null
  emailVerified: boolean
  emailVerifiedAt: string | null
  pendingEmail: string | null
  deletion: { status: 'awaiting_confirmation' | 'scheduled'; scheduledFor: string | null } | null
}

export const meApi = {
  profile: () => api.get<MeProfileDto>(`${BASE}/me`),
  patch: (body: { displayName?: string; locale?: string; timezone?: string }) =>
    api.patch<MeProfileDto>(`${BASE}/me`, body),
  requestDeletion: (body: { password: string; reason?: string }) =>
    api.post<{ requestId: string; requiresConfirmation: boolean; scheduledFor: string | null }>(
      `${BASE}/me/deletion-request`,
      body,
    ),
  cancelDeletion: () => api.delete<{ cancelled: boolean }>(`${BASE}/me/deletion-request`),
  requestEmailChange: (body: { password: string; newEmail: string }) =>
    api.post<{ pendingEmail: string; expiresAt: string }>(`${BASE}/me/email/change`, body),
  cancelEmailChange: () => api.delete<{ cancelled: true }>(`${BASE}/me/email/change`),
  resendVerification: () =>
    api.post<{ sentAt: string; expiresAt: string }>(`${BASE}/auth/email/verify/resend`),
  /** Export is a download, so it is a navigation rather than an XHR. */
  exportUrl: () => `${BASE}/me/export`,
}

/** Human verification. Public: a visitor who cannot get an image cannot register. */
export interface IssuedCaptchaDto {
  id: string
  purpose: 'register' | 'login'
  svg: string
  width: number
  height: number
  expiresAt: string
  /** Present only under `e2eMode` from a loopback address — never in production. */
  debugAnswer?: string
}

export const captchaApi = {
  issue: (purpose: 'register' | 'login') =>
    api.get<{ captcha: IssuedCaptchaDto }>(`${BASE}/auth/captcha?purpose=${purpose}`),
}
