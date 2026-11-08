import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as invitesRepo from '@/server/db/repositories/invitesRepo'
import * as attemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
import * as resetsRepo from '@/server/db/repositories/passwordResetsRepo'
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
  needsRehash,
  burnPasswordWork,
} from '@/server/auth/password'
import { codeHint, hashToken, newId, newInviteCode, newToken } from '@/server/auth/tokens'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as settingsService from '@/server/services/settingsService'
import * as auditService from '@/server/services/auditService'
import * as sessionService from '@/server/services/sessionService'
import { normalizeEmail, normalizeUsername } from '@/server/services/normalize'
import { log } from '@/server/http/requestContext'
import type { UserRow } from '@/server/db/types'
import type { UserStatus } from '@/server/db/types'

/**
 * Authentication.
 *
 * Everything here is written against the failure matrix in spec §2.6/§2.9:
 *  - one message for every credential failure (`invalid_credentials`), so the
 *    endpoint cannot be used to enumerate accounts;
 *  - a dummy scrypt run on the "user not found" path so response time does not
 *    leak existence either;
 *  - lockout with exponential back-off, capped at 24 h;
 *  - every attempt (success or not) is written to `login_attempts`, and every
 *    state change to `audit_events`.
 */

export interface LoginInput {
  identifier: string
  password: string
  client: 'web' | 'desktop'
  /**
   * Desktop build string. Optional in the service type (the HTTP schema already
   * defaults it to `''`) so non-HTTP callers — the CLI, the test suite — cannot
   * break on a field they do not have.
   */
  clientVersion?: string
  device: { name: string; platform: string; appVersion: string; deviceKey?: string }
  ip: string
  userAgent: string
  requestId: string
}

export interface LoginSuccess {
  user: UserRow
  role: { id: string; key: string; name: string }
  permissions: string[]
  tokens: {
    accessToken: string
    refreshToken: string
    accessExpiresAt: number
    refreshExpiresAt: number
  }
  sessionId: string
}

const LOCK_MAX_MS = 24 * 60 * 60 * 1000

function lockDurationMs(lockCount: number): number {
  const base = settingsService.getNumber('security.loginLockMinutes') * 60 * 1000
  return Math.min(base * 2 ** Math.max(0, lockCount - 1), LOCK_MAX_MS)
}

/** `1.0.10` → `[1, 0, 10]`; `null` when the string is not dotted digits. */
function parseVersion(value: string): number[] | null {
  const trimmed = value.trim().replace(/^v/i, '')
  if (!trimmed) return null
  const numbers: number[] = []
  for (const part of trimmed.split('.')) {
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }
  return numbers
}

/**
 * Semver-style comparison, tolerant of unequal segment counts (`1.2` vs `1.2.0`).
 *
 * An unparseable value on EITHER side answers `false`: a typo in the setting must
 * never become a fleet-wide lockout. The console validates the format; this is
 * the belt to that braces.
 */
export function isVersionOutdated(clientVersion: string, minVersion: string): boolean {
  const client = parseVersion(clientVersion)
  const minimum = parseVersion(minVersion)
  if (!client || !minimum) return false
  const length = Math.max(client.length, minimum.length)
  for (let index = 0; index < length; index += 1) {
    const left = client[index] ?? 0
    const right = minimum[index] ?? 0
    if (left !== right) return left < right
  }
  return false
}

function recordAttempt(
  identifierNormalized: string,
  ip: string,
  success: boolean,
  reason: string,
): void {
  attemptsRepo.insert(getDb(), {
    id: newId(),
    identifierNormalized,
    ip,
    success,
    reason,
    now: Date.now(),
  })
}

/**
 * Resolve a user by email OR username.
 *
 * The identifier is normalised first, so `Ada@Example.com` and `ada` both find
 * the same row and the two lookups stay index-backed.
 */
export function findUserByIdentifier(identifier: string): UserRow | undefined {
  return usersRepo.findByEmailOrUsername(
    getDb(),
    normalizeEmail(identifier),
    normalizeUsername(identifier),
  )
}

function assertCanAuthenticate(user: UserRow, now: number): void {
  if (user.status === 'suspended') {
    throw new AppError(ERROR_CODE.accountSuspended, '账号已被停用，请联系管理员')
  }
  if (user.status === 'deleted') {
    // Deliberately indistinguishable from a wrong password.
    throw errors.invalidCredentials()
  }
  if (user.status === 'pending') {
    throw new AppError(ERROR_CODE.accountSuspended, '账号尚未激活，请联系管理员')
  }
  if (user.locked_until !== null && user.locked_until > now) {
    const retryAfterSeconds = Math.ceil((user.locked_until - now) / 1000)
    throw new AppError(ERROR_CODE.accountLocked, '尝试次数过多，账号已被临时锁定', {
      details: { retryAfterSeconds },
      retryAfterSeconds,
    })
  }
}

function applyLockout(user: UserRow, now: number): void {
  const threshold = settingsService.getNumber('security.loginMaxAttempts')
  const db = getDb()
  const { count } = usersRepo.bumpFailedLogin(db, user.id, now)
  if (count < threshold) return
  const lockCount = usersRepo.incrementLockCount(db, user.id, now)
  usersRepo.setLockedUntil(db, user.id, now + lockDurationMs(lockCount), now)
  usersRepo.clearFailedLoginCountOnly(db, user.id, now)
}

export interface AuthenticateResult {
  user: UserRow
  role: { id: string; key: string; name: string }
  permissions: string[]
}

/** The subset of a login/register call the pre-credential gates look at. */
interface GateInput {
  client: 'web' | 'desktop'
  /** `undefined` and `''` both mean "this caller does not report a version". */
  clientVersion?: string | undefined
  ip: string
  requestId: string
}

/**
 * Maintenance mode: a non-empty announcement blocks new sign-ins and sign-ups.
 *
 * It deliberately does NOT block heartbeat, refresh or logout. An operator posting
 * "database maintenance tonight" must not eject everyone who is already working,
 * and a client that cannot reach logout forces users to kill the app.
 *
 * Records one audit row (never a `login_attempts` row) before throwing, so a wave
 * of 503s can be recognised as the announcement working rather than an attack.
 */
function assertNotInMaintenance(input: GateInput, source: 'login' | 'register'): void {
  const message = settingsService.getString('app.maintenanceMessage').trim()
  if (message === '') return
  auditService.record(
    { actorUserId: null, actorLabel: 'anonymous', ip: input.ip, requestId: input.requestId },
    {
      // One action for both endpoints: an operator filtering the audit log wants
      // "the announcement blocked people", not two near-identical rows.
      action: 'auth.login_blocked_maintenance',
      targetType: 'user',
      metadata: { client: input.client, source },
    },
  )
  throw new AppError(ERROR_CODE.serviceUnavailable, message, {
    details: { reason: 'maintenance' },
  })
}

/**
 * Version gate: an outdated desktop build is refused with 426 before the password
 * is even looked at.
 *
 * Applies only to `client === 'desktop'` with a non-empty `clientVersion`, and
 * never to heartbeat/refresh/logout — an old client still has to be able to sign
 * out of an existing session. Nothing is written to `login_attempts`, so a
 * misconfigured gate cannot lock an account out.
 */
function assertClientSupported(input: GateInput): void {
  const clientVersion = (input.clientVersion ?? '').trim()
  if (input.client !== 'desktop' || clientVersion === '') return
  const minVersion = settingsService.getString('client.minVersion').trim()
  if (minVersion === '') return
  if (parseVersion(minVersion) === null) {
    // A minimum nobody can parse would either block everyone or nobody. Both are
    // wrong, so the gate steps aside — but silently stepping aside is how an
    // operator concludes "the gate works" while every old build still gets in.
    log('warn', 'client.minVersion is not comparable; version gate skipped', { minVersion })
    return
  }
  if (parseVersion(clientVersion) === null) {
    // The desktop always sends `x.y.z`; anything else (a wrapped/vendored build
    // tag) cannot be ordered, so it is treated as "not provably old" — the same
    // fail-open the setting takes, and the reason the console validates `x.y.z`.
    log('warn', 'clientVersion is not comparable; version gate skipped', { clientVersion })
    return
  }
  if (!isVersionOutdated(clientVersion, minVersion)) return

  auditService.record(
    { actorUserId: null, actorLabel: 'anonymous', ip: input.ip, requestId: input.requestId },
    {
      action: 'auth.login_blocked_outdated_client',
      targetType: 'user',
      metadata: { clientVersion, minVersion },
    },
  )
  throw errors.clientOutdated(minVersion)
}

/**
 * Verify credentials without issuing a session.
 *
 * Split out because the login endpoint, the desktop heartbeat and the CLI all
 * need "is this password right" without the session side effects.
 *
 * @throws {AppError} `invalid_credentials` | `account_locked` |
 *         `account_suspended` | `password_mismatch` (change-password path).
 */
export async function verifyCredentials(
  identifier: string,
  password: string,
  context: { ip: string; reasonPrefix?: string },
): Promise<AuthenticateResult> {
  const now = Date.now()
  const normalized = normalizeEmail(identifier)
  const user = findUserByIdentifier(identifier)

  if (!user) {
    // Same CPU cost as a real verification so timing cannot be used to probe.
    await burnPasswordWork(password)
    recordAttempt(normalized, context.ip, false, 'unknown_identifier')
    throw errors.invalidCredentials()
  }

  assertCanAuthenticate(user, now)

  const matches = await verifyPassword(password, user.password_hash)
  if (!matches) {
    recordAttempt(user.email_normalized, context.ip, false, 'bad_password')
    applyLockout(user, now)
    throw errors.invalidCredentials()
  }

  if (needsRehash(user.password_hash)) {
    const rehashed = await hashPassword(password)
    usersRepo.update(getDb(), user.id, { password_hash: rehashed } as Partial<UserRow>, now)
  }

  usersRepo.clearFailedLogin(getDb(), user.id, now)
  recordAttempt(user.email_normalized, context.ip, true, 'ok')

  const role = rolesRepo.findById(getDb(), user.role_id)
  if (!role) throw new AppError(ERROR_CODE.internalError, '用户角色数据缺失')
  return {
    user,
    role: { id: role.id, key: role.key, name: role.name },
    permissions: rolesRepo.permissionsFor(getDb(), role.id),
  }
}

/** Full login: verify, mark the user, mint a session, audit. */
export async function login(input: LoginInput): Promise<LoginSuccess> {
  // Order is fixed (spec §2.11): rate limit in the route → maintenance →
  // version gate → credential check. The two gates run before the password, so
  // they must never write `login_attempts` nor count towards the lockout.
  assertNotInMaintenance(input, 'login')
  assertClientSupported(input)

  const authenticated = await verifyCredentials(input.identifier, input.password, {
    ip: input.ip,
  })
  const now = Date.now()
  usersRepo.markLoggedIn(getDb(), authenticated.user.id, now)

  // Synchronous by contract: one transaction retires this device's previous
  // session and inserts the new one (see `replaceDeviceSession`).
  const issued = sessionService.replaceDeviceSession({
    userId: authenticated.user.id,
    client: input.client,
    ip: input.ip,
    userAgent: input.userAgent,
    deviceName: input.device.name,
    platform: input.device.platform,
    appVersion: input.device.appVersion,
    deviceKey: input.device.deviceKey ?? '',
  })

  if (issued.replacedCount > 0) {
    auditService.record(
      {
        actorUserId: authenticated.user.id,
        actorLabel: authenticated.user.email,
        ip: input.ip,
        requestId: input.requestId,
      },
      {
        action: 'auth.session_relogin',
        targetType: 'user',
        targetId: authenticated.user.id,
        metadata: { deviceKey: input.device.deviceKey ?? '', replacedCount: issued.replacedCount },
      },
    )
  }

  auditService.record(
    {
      actorUserId: authenticated.user.id,
      actorLabel: authenticated.user.email,
      ip: input.ip,
      requestId: input.requestId,
    },
    {
      action: 'auth.login',
      targetType: 'session',
      targetId: issued.sessionId,
      metadata: { client: input.client, platform: input.device.platform },
    },
  )

  return {
    user: authenticated.user,
    role: authenticated.role,
    permissions: authenticated.permissions,
    tokens: {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
    },
    sessionId: issued.sessionId,
  }
}

export interface RegisterInput {
  email: string
  password: string
  username?: string
  displayName?: string
  inviteCode?: string
  client: 'web' | 'desktop'
  /** Desktop build string; gated by the same 426 answer as login. */
  clientVersion?: string
  device: { name: string; platform: string; appVersion: string; deviceKey?: string }
  ip: string
  userAgent: string
  requestId: string
}

export type RegisterSuccess = LoginSuccess

function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user'
  return local.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 28) || 'user'
}

/**
 * Self-service registration.
 *
 * Order matters: the registration switch, then the invite gate, then the policy,
 * then uniqueness. Checking uniqueness first would leak which addresses exist
 * even when registration is closed.
 */
export async function register(input: RegisterInput): Promise<RegisterSuccess> {
  const db = getDb()
  const now = Date.now()

  // Same pre-credential gates as login, in the same order. A closed registration
  // must not hide a "your build is too old" answer from somebody who cannot
  // upgrade yet: the two are different problems with different support routes.
  assertNotInMaintenance(input, 'register')
  assertClientSupported(input)

  if (!settingsService.getBoolean('registration.enabled')) {
    throw new AppError(ERROR_CODE.registrationDisabled, '当前不开放注册')
  }

  const inviteRequired = settingsService.getBoolean('invite.required')
  const inviteCode = input.inviteCode?.trim()
  if (inviteRequired && !inviteCode) {
    throw new AppError(ERROR_CODE.inviteRequired, '注册需要邀请码')
  }

  const emailNormalized = normalizeEmail(input.email)
  const desiredUsername = input.username?.trim() || usernameFromEmail(input.email)
  const usernameNormalized = normalizeUsername(desiredUsername)

  const policy = validatePasswordPolicy({
    password: input.password,
    email: emailNormalized,
    username: usernameNormalized,
    displayName: input.displayName,
  })
  if (!policy.ok) {
    throw new AppError(ERROR_CODE.weakPassword, '口令不符合安全要求', {
      details: { reasons: policy.reasons },
    })
  }

  if (usersRepo.emailExists(db, emailNormalized)) {
    throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被注册')
  }
  if (usersRepo.usernameExists(db, usernameNormalized)) {
    throw new AppError(ERROR_CODE.usernameTaken, '该用户名已被占用')
  }

  let roleId: string
  let inviteId: string | null = null
  if (inviteCode) {
    const invite = invitesRepo.findByHash(
      db,
      hashToken(getConfig().sessionSecret, inviteCode.toUpperCase()),
    )
    if (!invite || invite.revoked_at !== null) {
      throw new AppError(ERROR_CODE.inviteInvalid, '邀请码无效')
    }
    if (invite.expires_at !== null && invite.expires_at <= now) {
      throw new AppError(ERROR_CODE.inviteExhausted, '邀请码已过期')
    }
    roleId = invite.role_id
    inviteId = invite.id
  } else {
    const memberRole = rolesRepo.findByKey(db, 'member')
    if (!memberRole) throw new AppError(ERROR_CODE.internalError, '默认角色缺失')
    roleId = memberRole.id
  }

  const passwordHash = await hashPassword(input.password)
  const userId = newId()

  const create = db.transaction(() => {
    usersRepo.create(db, {
      id: userId,
      email: input.email.trim(),
      emailNormalized,
      username: desiredUsername,
      usernameNormalized,
      displayName: input.displayName?.trim() || desiredUsername,
      passwordHash,
      roleId,
      status: 'active' as UserStatus,
      planTag: 'free',
      mustChangePassword: false,
      now,
    })
    if (inviteId) {
      const consumed = invitesRepo.consume(db, inviteId, now)
      if (!consumed) {
        throw new AppError(ERROR_CODE.inviteExhausted, '邀请码已被用完')
      }
    }
  })
  create()

  const role = rolesRepo.findById(db, roleId)
  if (!role) throw new AppError(ERROR_CODE.internalError, '角色数据缺失')

  auditService.record(
    { actorUserId: userId, actorLabel: emailNormalized, ip: input.ip, requestId: input.requestId },
    {
      action: 'user.register',
      targetType: 'user',
      targetId: userId,
      metadata: { inviteUsed: Boolean(inviteId), roleKey: role.key },
    },
  )

  const issued = sessionService.createSession({
    userId,
    client: input.client,
    ip: input.ip,
    userAgent: input.userAgent,
    deviceName: input.device.name,
    platform: input.device.platform,
    appVersion: input.device.appVersion,
    deviceKey: input.device.deviceKey ?? '',
  })

  const user = usersRepo.findById(db, userId)
  if (!user) throw new AppError(ERROR_CODE.internalError, '用户创建后无法读取')

  return {
    user,
    role: { id: role.id, key: role.key, name: role.name },
    permissions: rolesRepo.permissionsFor(db, role.id),
    tokens: {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
    },
    sessionId: issued.sessionId,
  }
}

export function logout(sessionId: string, userId: string, requestId: string, ip: string): void {
  sessionService.revokeOne(sessionId, REVOKE_REASON.logout)
  auditService.record(
    { actorUserId: userId, actorLabel: userId, ip, requestId },
    { action: 'auth.logout', targetType: 'session', targetId: sessionId },
  )
}

export interface ChangePasswordInput {
  userId: string
  currentPassword: string
  newPassword: string
  signOutOtherSessions: boolean
  currentSessionId: string
  requestId: string
  ip: string
}

/**
 * Self-service password change. Requires the current password: a stolen session
 * alone must not be enough to lock the real owner out.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const db = getDb()
  const user = usersRepo.findById(db, input.userId)
  if (!user) throw errors.unauthorized()

  const matches = await verifyPassword(input.currentPassword, user.password_hash)
  if (!matches) {
    throw new AppError(ERROR_CODE.passwordMismatch, '当前口令不正确')
  }

  const policy = validatePasswordPolicy({
    password: input.newPassword,
    email: user.email_normalized,
    username: user.username_normalized,
    displayName: user.display_name,
  })
  if (!policy.ok) {
    throw new AppError(ERROR_CODE.weakPassword, '新口令不符合安全要求', {
      details: { reasons: policy.reasons },
    })
  }

  const now = Date.now()
  const hash = await hashPassword(input.newPassword)
  usersRepo.update(
    db,
    user.id,
    {
      password_hash: hash,
      password_updated_at: now,
      must_change_password: 0,
    } as Partial<UserRow>,
    now,
  )

  if (input.signOutOtherSessions) {
    sessionService.revokeAllForUser(user.id, REVOKE_REASON.passwordChanged, input.currentSessionId)
  }

  auditService.record(
    { actorUserId: user.id, actorLabel: user.email, ip: input.ip, requestId: input.requestId },
    {
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      metadata: { signedOutOthers: input.signOutOtherSessions },
    },
  )
}

/**
 * Begin a self-service reset.
 *
 * Always reports success (`202`) with no body detail: whether the address exists
 * and whether SMTP is configured are both non-public facts.
 *
 * @returns the plaintext token when the reset link could be issued, else null.
 */
export async function requestPasswordReset(
  email: string,
  context: { ip: string; requestId: string },
): Promise<{ token: string | null; user: UserRow | null }> {
  const db = getDb()
  const now = Date.now()
  const user = usersRepo.findByEmailOrUsername(db, normalizeEmail(email), normalizeUsername(email))
  if (!user || user.status !== 'active') return { token: null, user: null }

  const token = newToken()
  resetsRepo.create(db, {
    id: newId(),
    userId: user.id,
    tokenHash: hashToken(getConfig().sessionSecret, token),
    issuedBy: null,
    expiresAt: now + 60 * 60 * 1000,
    now,
  })
  auditService.record(
    { actorUserId: user.id, actorLabel: user.email, ip: context.ip, requestId: context.requestId },
    { action: 'auth.reset_requested', targetType: 'user', targetId: user.id },
  )
  return { token, user }
}

/** Complete a reset with a one-time token. */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  context: { ip: string; requestId: string },
): Promise<void> {
  const db = getDb()
  const now = Date.now()
  const record = resetsRepo.findByHash(db, hashToken(getConfig().sessionSecret, token))
  if (!record || record.used_at !== null || record.expires_at <= now) {
    throw new AppError(ERROR_CODE.inviteInvalid, '重置链接无效或已过期')
  }
  const user = usersRepo.findById(db, record.user_id)
  if (!user || user.status !== 'active') {
    throw new AppError(ERROR_CODE.inviteInvalid, '重置链接无效或已过期')
  }

  const policy = validatePasswordPolicy({
    password: newPassword,
    email: user.email_normalized,
    username: user.username_normalized,
    displayName: user.display_name,
  })
  if (!policy.ok) {
    throw new AppError(ERROR_CODE.weakPassword, '新口令不符合安全要求', {
      details: { reasons: policy.reasons },
    })
  }

  const hash = await hashPassword(newPassword)
  const apply = db.transaction(() => {
    if (!resetsRepo.consume(db, record.id, now)) {
      throw new AppError(ERROR_CODE.inviteInvalid, '重置链接已被使用')
    }
    usersRepo.update(
      db,
      user.id,
      {
        password_hash: hash,
        password_updated_at: now,
        must_change_password: 0,
      } as Partial<UserRow>,
      now,
    )
    usersRepo.clearFailedLogin(db, user.id, now)
  })
  apply()

  sessionService.revokeAllForUser(user.id, REVOKE_REASON.passwordChanged)
  auditService.record(
    { actorUserId: user.id, actorLabel: user.email, ip: context.ip, requestId: context.requestId },
    { action: 'auth.password_reset', targetType: 'user', targetId: user.id },
  )
}

export { newInviteCode, codeHint }
