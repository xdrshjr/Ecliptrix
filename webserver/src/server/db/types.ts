/**
 * Row shapes as they exist in SQLite (epoch milliseconds, integers) plus the
 * DTO mapping used at the API boundary (ISO-8601 strings, booleans).
 *
 * Repositories return rows verbatim; services convert with `toXDto` so the
 * single place that knows about time representation stays here.
 */

export type UserStatus = 'active' | 'suspended' | 'pending' | 'deleted'
export type SessionClient = 'web' | 'desktop'
export type PlanTag = 'free' | 'pro' | 'studio'

export interface RoleRow {
  id: string
  key: string
  name: string
  description: string
  is_system: number
  created_at: number
  updated_at: number
}

export interface UserRow {
  id: string
  email: string
  email_normalized: string
  username: string
  username_normalized: string
  display_name: string
  password_hash: string
  password_updated_at: number
  role_id: string
  status: UserStatus
  plan_tag: string
  must_change_password: number
  email_verified_at: number | null
  avatar_url: string | null
  locale: string
  timezone: string
  note: string
  last_login_at: number | null
  failed_login_count: number
  lock_count: number
  locked_until: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface SessionRow {
  id: string
  user_id: string
  client: SessionClient
  access_token_hash: string
  refresh_token_hash: string | null
  device_name: string
  platform: string
  app_version: string
  ip: string
  user_agent: string
  created_at: number
  last_seen_at: number
  access_expires_at: number
  refresh_expires_at: number | null
  revoked_at: number | null
  revoked_reason: string | null
}

export interface InviteRow {
  id: string
  code_hash: string
  code_hint: string
  created_by: string
  role_id: string
  max_uses: number
  used_count: number
  expires_at: number | null
  revoked_at: number | null
  created_at: number
}

export interface PasswordResetRow {
  id: string
  user_id: string
  token_hash: string
  issued_by: string | null
  expires_at: number
  used_at: number | null
  created_at: number
}

export interface LoginAttemptRow {
  id: string
  identifier_normalized: string
  ip: string
  success: number
  reason: string
  created_at: number
}

export interface AuditRow {
  id: string
  actor_user_id: string | null
  actor_label: string
  action: string
  target_type: string
  target_id: string
  metadata: string
  ip: string
  request_id: string
  created_at: number
}

export interface SettingRow {
  key: string
  value: string
  updated_by: string | null
  updated_at: number
}

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface Paged<T> {
  items: T[]
  page: PageMeta
}

export function iso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  return new Date(ms).toISOString()
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

export function bool(value: number | null | undefined): boolean {
  return value === 1
}

export interface RoleDto {
  id: string
  key: string
  name: string
  description: string
  isSystem: boolean
}

export function toRoleDto(row: RoleRow): RoleDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: bool(row.is_system),
  }
}

export interface PublicUserDto {
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null
  locale: string
  timezone: string
  status: UserStatus
  planTag: string
  mustChangePassword: boolean
  createdAt: string
  lastLoginAt: string | null
}

export function toPublicUserDto(row: UserRow): PublicUserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    locale: row.locale,
    timezone: row.timezone,
    status: row.status,
    planTag: row.plan_tag,
    mustChangePassword: bool(row.must_change_password),
    createdAt: toIso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
  }
}

export interface SessionDto {
  id: string
  client: SessionClient
  deviceName: string
  platform: string
  appVersion: string
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  current: boolean
}

export function toSessionDto(row: SessionRow, currentSessionId?: string): SessionDto {
  return {
    id: row.id,
    client: row.client,
    deviceName: row.device_name,
    platform: row.platform,
    appVersion: row.app_version,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    expiresAt: toIso(row.access_expires_at),
    current: currentSessionId === row.id,
  }
}
