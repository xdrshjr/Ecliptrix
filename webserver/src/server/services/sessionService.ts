import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as repo from '@/server/db/repositories/sessionsRepo'
import { hashToken, newToken } from '@/server/auth/tokens'
import { REVOKE_REASON } from '@/server/auth/constants'
import * as settingsService from '@/server/services/settingsService'
import type { SessionClient, SessionRow } from '@/server/db/types'

/**
 * Session lifecycle.
 *
 * The service owns the *policy* (who gets a session, how long, when to revoke);
 * the repository owns the rows. Callers pass device/request metadata and get
 * back the plaintext tokens exactly once.
 */

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  refreshExpiresAt: number
  sessionId: string
}

export interface CreateSessionOptions {
  userId: string
  client: SessionClient
  ip: string
  userAgent: string
  deviceName?: string
  platform?: string
  appVersion?: string
  /** Stable per-machine fingerprint; empty string for browser sessions. */
  deviceKey?: string
}

function ttlFor(client: SessionClient): { accessMs: number; refreshMs: number } {
  const config = getConfig()
  return {
    accessMs: config.accessTokenTtlHours * 60 * 60 * 1000,
    refreshMs:
      (client === 'desktop' ? config.desktopRefreshTokenTtlDays : config.refreshTokenTtlDays) *
      24 *
      60 *
      60 *
      1000,
  }
}

/**
 * Create a session and return the plaintext pair.
 *
 * A per-user cap is enforced by revoking the least recently used sessions: an
 * unbounded list of live sessions is both a UX problem (the device list becomes
 * noise) and a security problem (every one is a token that can leak).
 *
 * The cap itself is the `security.maxActiveSessions` setting, not a constant, so
 * an operator can adjust it for their real device count without a redeploy.
 */
export function createSession(options: CreateSessionOptions): IssuedTokens {
  const db = getDb()
  const config = getConfig()
  const now = Date.now()
  const ttl = ttlFor(options.client)
  const maxActiveSessions = settingsService.getNumber('security.maxActiveSessions')

  const accessToken = newToken()
  const refreshToken = newToken()
  const sessionId = newToken().slice(0, 22)

  const stolen = repo.oldestActiveIds(db, options.userId, maxActiveSessions - 1, now)
  for (const id of stolen) repo.revokeOne(db, id, now, REVOKE_REASON.sessionLimit)

  repo.create(db, {
    id: sessionId,
    userId: options.userId,
    client: options.client,
    accessTokenHash: hashToken(config.sessionSecret, accessToken),
    refreshTokenHash: hashToken(config.sessionSecret, refreshToken),
    deviceName: options.deviceName ?? '',
    platform: options.platform ?? '',
    appVersion: options.appVersion ?? '',
    deviceKey: options.deviceKey ?? '',
    ip: options.ip,
    userAgent: options.userAgent,
    now,
    accessExpiresAt: now + ttl.accessMs,
    refreshExpiresAt: now + ttl.refreshMs,
  })

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: now + ttl.accessMs,
    refreshExpiresAt: now + ttl.refreshMs,
    sessionId,
  }
}

export interface ReplaceDeviceResult extends IssuedTokens {
  /** How many earlier sessions of the same device were retired (0 on first login). */
  replacedCount: number
}

/**
 * Mint a session, retiring the previous session of the same device.
 *
 * **This function must stay synchronous and its body must never contain
 * `await`.** `better-sqlite3`'s `db.transaction(fn)` commits as soon as `fn`
 * returns; an `await` inside would end the transaction in the middle of the
 * work (and then throw against an already-committed transaction). That is why
 * the replacement lives here and not inside `authService.login()`, which is
 * `async` because it verifies a scrypt password.
 *
 * A blank `deviceKey` (web login, old clients) degrades to `createSession`, so
 * browser behaviour is byte-for-byte what it was before migration 0004.
 *
 * @throws {AppError} whatever `createSession` throws — in that case the whole
 *         transaction rolls back and the previous device session stays valid.
 */
export function replaceDeviceSession(
  options: CreateSessionOptions & { deviceKey: string },
): ReplaceDeviceResult {
  if (options.deviceKey === '') return { ...createSession(options), replacedCount: 0 }

  const db = getDb()
  const replace = db.transaction((input: CreateSessionOptions & { deviceKey: string }) => {
    const replacedCount = repo.revokeActiveByDevice(
      db,
      input.userId,
      input.deviceKey,
      Date.now(),
      REVOKE_REASON.sameDeviceRelogin,
    )
    return { ...createSession(input), replacedCount }
  })
  return replace(options)
}

/** Resolve a session from an access token. Returns the row even when revoked. */
export function sessionFromAccessToken(token: string): SessionRow | undefined {
  const db = getDb()
  return repo.findByAccessHash(db, hashToken(getConfig().sessionSecret, token))
}

export function sessionFromId(id: string): SessionRow | undefined {
  return repo.findById(getDb(), id)
}

export interface RotateResult extends IssuedTokens {
  userId: string
}

/**
 * Rotate a refresh token, detecting reuse.
 *
 * Reuse detection: presenting a refresh token whose row has been rotated away
 * means two parties hold the same token. The safe response is to revoke every
 * session of that user and record the event — a legitimate user simply signs in
 * again, an attacker loses access.
 *
 * @returns null when the token is unknown (no row at all).
 */
export function rotateRefreshToken(
  presented: string,
  meta: { ip: string; userAgent: string },
): RotateResult | 'reuse-detected' | null {
  const db = getDb()
  const config = getConfig()
  const now = Date.now()
  const presentedHash = hashToken(config.sessionSecret, presented)

  const live = repo.findByRefreshHash(db, presentedHash)
  if (!live) {
    // Not a live token. It may be a digest we retired on an earlier rotation —
    // that is the signature of a stolen copy being replayed after the
    // legitimate client already rotated it.
    const retired = repo.findRetiredRefreshHash(db, presentedHash)
    if (!retired) return null
    repo.recordRefreshReuse(db, {
      id: newToken().slice(0, 22),
      sessionId: retired.session_id,
      userId: retired.user_id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      now,
    })
    repo.revokeAllForUser(db, retired.user_id, now, REVOKE_REASON.refreshReuse)
    return 'reuse-detected'
  }

  if (live.revoked_at !== null) return null
  if (live.refresh_expires_at !== null && live.refresh_expires_at <= now) return null

  const accessToken = newToken()
  const refreshToken = newToken()
  const ttl = ttlFor(live.client)

  repo.rotate(db, live, {
    accessTokenHash: hashToken(config.sessionSecret, accessToken),
    refreshTokenHash: hashToken(config.sessionSecret, refreshToken),
    accessExpiresAt: now + ttl.accessMs,
    refreshExpiresAt: now + ttl.refreshMs,
    now,
  })

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: now + ttl.accessMs,
    refreshExpiresAt: now + ttl.refreshMs,
    sessionId: live.id,
    userId: live.user_id,
  }
}

export function touch(sessionId: string, now = Date.now()): void {
  repo.touch(getDb(), sessionId, now)
}

/**
 * Why a refresh token is unusable, when the row still exists.
 *
 * `rotateRefreshToken` answers `null` for "revoked" and "expired" alike, but the
 * desktop has to tell a kicked-out user (`session_revoked` + reason
 * `account_deleted`) from an ordinary expiry: the first shows "your account was
 * deleted", the second returns to the login screen. Reported in
 * `error.details.reason` (spec §5.2, D3-08).
 */
export function revokeReasonForRefreshToken(token: string): string | null {
  const row = repo.findByRefreshHash(getDb(), hashToken(getConfig().sessionSecret, token))
  if (!row || row.revoked_at === null) return null
  return row.revoked_reason
}

export function revokeOne(sessionId: string, reason: string): boolean {
  const db = getDb()
  const session = repo.findById(db, sessionId)
  if (!session || session.revoked_at !== null) return false
  repo.revokeOne(db, sessionId, Date.now(), reason)
  return true
}

export function revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): number {
  return repo.revokeAllForUser(getDb(), userId, Date.now(), reason, exceptSessionId)
}

export function listForUser(userId: string): SessionRow[] {
  return repo.listForUser(getDb(), userId)
}

export function isUsable(session: SessionRow, now = Date.now()): boolean {
  return session.revoked_at === null && session.access_expires_at > now
}
