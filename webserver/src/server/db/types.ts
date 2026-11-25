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
  /** Last successful data export; drives the export cooldown (migration 0005). */
  last_exported_at: number | null
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
  /**
   * Stable per-machine fingerprint sent by the desktop client. Empty string for
   * web sessions and for rows written before migration 0004.
   */
  device_key: string
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

/** One publishable desktop installer (migration 0006). */
export type ClientReleaseStatus = 'draft' | 'published' | 'retracted'

export interface ClientReleaseRow {
  id: string
  version: string
  platform: string
  arch: string
  /** Display name only; the bytes live at `storage_key`. */
  file_name: string
  /** Path relative to `RELEASES_DIR`, content-addressed. */
  storage_key: string
  byte_size: number
  sha256: string
  notes: string
  status: ClientReleaseStatus
  downloads: number
  created_by: string | null
  created_at: number
  published_at: number | null
  retracted_at: number | null
}

/** The same row with the uploader's address resolved for the console table. */
export interface ClientReleaseWithAuthorRow extends ClientReleaseRow {
  created_by_label: string | null
}

/** "Which release is current for this platform" — one row per (channel, platform). */
export interface ClientReleaseChannelRow {
  channel: string
  platform: string
  release_id: string | null
  updated_at: number
  updated_by: string | null
}

export interface ClientReleaseDto {
  id: string
  version: string
  platform: string
  arch: string
  fileName: string
  byteSize: number
  sha256: string
  notes: string
  status: ClientReleaseStatus
  downloads: number
  createdBy: string | null
  createdAt: string
  publishedAt: string | null
  retractedAt: string | null
}

export function toClientReleaseDto(row: ClientReleaseRow): ClientReleaseDto {
  return {
    id: row.id,
    version: row.version,
    platform: row.platform,
    arch: row.arch,
    fileName: row.file_name,
    byteSize: row.byte_size,
    sha256: row.sha256,
    notes: row.notes,
    status: row.status,
    downloads: row.downloads,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    publishedAt: iso(row.published_at),
    retractedAt: iso(row.retracted_at),
  }
}

/** What `/api/v1/releases/latest` exposes per platform. */
export interface PublishedReleaseDto {
  platform: string
  arch: string
  version: string
  fileName: string
  byteSize: number
  sha256: string
  notes: string
  publishedAt: string
  downloads: number
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
  /**
   * Whether the address has been proven. Login and register answer the same shape,
   * so the desktop can show its "unverified" banner without a second request.
   */
  emailVerified: boolean
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
    emailVerified: row.email_verified_at !== null,
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
  /** Echoed back so the desktop can mark "this is my device" in its own list. */
  deviceKey: string
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
    deviceKey: row.device_key,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    expiresAt: toIso(row.access_expires_at),
    current: currentSessionId === row.id,
  }
}
