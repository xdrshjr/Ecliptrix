import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as tokensRepo from '@/server/db/repositories/emailActionTokensRepo'
import * as deletionRepo from '@/server/db/repositories/deletionRequestsRepo'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import { hashToken, newId, newToken } from '@/server/auth/tokens'
import { verifyPassword } from '@/server/auth/password'
import * as auditService from '@/server/services/auditService'
import * as authorityService from '@/server/services/authorityService'
import * as mailService from '@/server/services/mailService'
import * as sessionService from '@/server/services/sessionService'
import * as settingsService from '@/server/services/settingsService'
import { maskEmail } from '@/server/services/privacy'
import { normalizeEmail } from '@/server/services/normalize'
import { buildAccountUrl, buildVerifyUrl } from '@/server/mail/links'
import { translator, type Locale } from '@/lib/i18n'
import { log } from '@/server/http/requestContext'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * Address ownership: verification, change-of-address, and the administrator
 * override for "the user cannot receive mail".
 *
 * The rules that make this safe live in `emailActionTokensRepo.issue`: every
 * unused token of `(user, purpose)` is invalidated before the new one is
 * inserted. The `(user, purpose) WHERE used_at IS NULL` unique index does not
 * look at `expires_at`, so "the user clicks resend the next day" would otherwise
 * be a guaranteed 500.
 *
 * Nothing here sends mail directly — `mailService` is the only exit — and nothing
 * here turns a delivery outcome into an HTTP status. The one exception is
 * "resend on a deployment without SMTP", where the action simply cannot happen:
 * that answers `503 mail_disabled`.
 */

export interface IssueResult {
  outboxId: string | null
  expiresAt: number
}

function ttlHours(key: 'mail.verificationTtlHours' | 'mail.emailChangeTtlHours'): number {
  return settingsService.getNumber(key)
}

function expiresInLabel(hours: number, locale: Locale): string {
  const tt = translator(locale)
  return tt('mail.duration.hours', { count: hours })
}

/**
 * Issue a verification token and mail the link.
 *
 * Called from `authService.register` (fire and forget) and from the resend
 * endpoint. The token is generated, hashed and mailed; only the digest is stored.
 */
export function issueVerification(
  user: UserRow,
  options: { ip: string; locale?: Locale },
): IssueResult {
  const db = getDb()
  const now = Date.now()
  const hours = ttlHours('mail.verificationTtlHours')
  const expiresAt = now + hours * 60 * 60 * 1000
  const token = newToken()

  tokensRepo.issue(db, {
    id: newId(),
    userId: user.id,
    purpose: 'verify',
    emailNormalized: '',
    tokenHash: hashToken(getConfig().sessionSecret, token),
    expiresAt,
    ip: options.ip,
    now,
  })

  const locale = options.locale ?? (user.locale === 'en-US' ? 'en-US' : 'zh-CN')
  mailService.queueInBackground({
    template: 'verify-email',
    to: user.email,
    locale,
    userId: user.id,
    params: {
      displayName: user.display_name,
      maskedEmail: maskEmail(user.email),
      link: buildVerifyUrl(token),
      expiresIn: expiresInLabel(hours, locale),
    },
  })
  return { outboxId: null, expiresAt }
}

export interface ResendResult {
  sentAt: string
  expiresAt: string
}

/**
 * Resend the verification mail.
 *
 * @throws {AppError} `email_already_verified` (409) when there is nothing to
 *         verify, `mail_disabled` (503) when the deployment cannot send.
 */
export function resendVerification(
  user: UserRow,
  context: { ip: string; locale?: Locale; audit: AuditContext },
): ResendResult {
  if (user.email_verified_at !== null) {
    throw new AppError(ERROR_CODE.emailAlreadyVerified, '该邮箱已经验证通过')
  }
  if (!mailService.isMailEnabled()) throw errors.mailDisabled()

  const result = issueVerification(user, { ip: context.ip, locale: context.locale })
  auditService.record(context.audit, {
    action: 'auth.email_verify_resent',
    targetType: 'user',
    targetId: user.id,
    metadata: { expiresAt: new Date(result.expiresAt).toISOString() },
  })
  return { sentAt: new Date().toISOString(), expiresAt: new Date(result.expiresAt).toISOString() }
}

export interface VerifyResult {
  email: string
  verifiedAt: string
  changed: boolean
  sessionsRevoked?: number
}

/**
 * Consume a mailed token — either a first verification or an address change.
 *
 * Unknown, expired, already used and wrong-purpose all answer the same
 * `token_invalid`: distinguishing them would let a caller probe which tokens ever
 * existed (spec §3.4 action 3).
 */
export async function consumeVerificationToken(
  token: string,
  context: { ip: string; requestId: string; currentSessionId?: string },
): Promise<VerifyResult> {
  const db = getDb()
  const now = Date.now()
  const record = tokensRepo.findByHash(db, hashToken(getConfig().sessionSecret, token))
  if (!record || record.used_at !== null || record.expires_at <= now) {
    throw errors.tokenInvalid()
  }

  const user = usersRepo.findById(db, record.user_id)
  if (!user || user.status !== 'active') throw errors.tokenInvalid()

  if (record.purpose === 'verify') {
    const apply = db.transaction(() => {
      if (!tokensRepo.consume(db, record.id, now)) throw errors.tokenInvalid()
      usersRepo.update(db, user.id, { email_verified_at: now } as Partial<UserRow>, now)
    })
    apply()
    auditService.record(
      { actorUserId: user.id, actorLabel: user.email, ip: context.ip, requestId: context.requestId },
      {
        action: 'auth.email_verified',
        targetType: 'user',
        targetId: user.id,
        metadata: { purpose: 'verify' },
      },
    )
    return {
      email: user.email,
      verifiedAt: new Date(now).toISOString(),
      changed: false,
    }
  }

  return applyEmailChange(user, record.id, record.email_normalized, context)
}

/**
 * Second half of a change of address.
 *
 * The unique index on `email_normalized` is the real guard against two accounts
 * racing for the same new address: one transaction wins, the other answers
 * `409 email_taken` from SQLite rather than from a check-then-write.
 *
 * `currentSessionId` is the session behind the request, when there is one: every
 * OTHER session is revoked. Without it the tab that clicked the confirmation link
 * signed itself out of the page it was standing on, which reads as a bug.
 */
function applyEmailChange(
  user: UserRow,
  tokenId: string,
  newEmailNormalized: string,
  context: { ip: string; requestId: string; currentSessionId?: string },
): VerifyResult {
  const db = getDb()
  const now = Date.now()
  const previousEmail = user.email

  if (!newEmailNormalized) throw errors.tokenInvalid()
  if (usersRepo.emailExists(db, newEmailNormalized, user.id)) {
    throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被其他账号使用')
  }

  let revoked = 0
  const apply = db.transaction(() => {
    if (!tokensRepo.consume(db, tokenId, now)) throw errors.tokenInvalid()
    usersRepo.update(
      db,
      user.id,
      {
        email: newEmailNormalized,
        email_normalized: newEmailNormalized,
        // Proving control of the new address is exactly what verification means.
        email_verified_at: now,
      } as Partial<UserRow>,
      now,
    )
    tokensRepo.invalidateAllForUser(db, user.id, now)
    revoked = sessionService.revokeAllForUser(
      user.id,
      REVOKE_REASON.emailChanged,
      context.currentSessionId,
    )
  })
  try {
    apply()
  } catch (error) {
    // A concurrent confirmation of the same address trips the unique index.
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被其他账号使用')
    }
    throw error
  }

  auditService.record(
    // Masked actor label: `actor_label` sits in the same row whose metadata is
    // deliberately masked, so writing the full new address here would hand the
    // address book back to anyone reading `audit_events`.
    { actorUserId: user.id, actorLabel: maskEmail(newEmailNormalized), ip: context.ip, requestId: context.requestId },
    {
      action: 'user.email_changed',
      targetType: 'user',
      targetId: user.id,
      // Masked on both sides: an audit row must not become an address book.
      metadata: { from: maskEmail(previousEmail), to: maskEmail(newEmailNormalized), sessionsRevoked: revoked },
    },
  )

  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'email-changed',
    to: previousEmail,
    locale,
    userId: user.id,
    params: { displayName: user.display_name },
  })

  return {
    email: newEmailNormalized,
    verifiedAt: new Date(now).toISOString(),
    changed: true,
    sessionsRevoked: revoked,
  }
}

/** Administrator override: "this user cannot receive mail, let them in". */
export function markVerifiedByAdmin(
  userId: string,
  actor: AuditContext,
): { emailVerifiedAt: string } {
  const db = getDb()
  const user = usersRepo.findById(db, userId)
  if (!user) throw errors.notFound('用户不存在')
  // INV-1, entry #9 (review R-V4-01). Verifying an address on somebody's behalf is
  // not a read: it completes the one step that lets an account receive resets and
  // change notices, so a lower-ranked administrator must not be able to do it for a
  // peer. The route only checked `users.write`, which every `admin` holds.
  authorityService.assertRankAbove(actor.actorUserId, userId)
  if (user.email_verified_at !== null) {
    throw new AppError(ERROR_CODE.emailAlreadyVerified, '该邮箱已经验证通过')
  }
  const now = Date.now()
  usersRepo.update(db, userId, { email_verified_at: now } as Partial<UserRow>, now)
  tokensRepo.invalidateAllForUser(db, userId, now)
  auditService.record(actor, {
    action: 'user.email_verified_by_admin',
    targetType: 'user',
    targetId: userId,
    metadata: { actor: actor.actorUserId ?? 'system' },
  })
  return { emailVerifiedAt: new Date(now).toISOString() }
}

export interface EmailChangeRequest {
  password: string
  newEmail: string
}

export interface EmailChangePending {
  pendingEmail: string
  expiresAt: string
}

/**
 * Begin a change of address.
 *
 * Two mails go out: the confirmation link to the NEW address and a notice to the
 * old one. The notice is the only early warning the real owner gets if somebody
 * with a stolen session attempts a takeover; without it, "change the address then
 * use password reset" is a silent account theft.
 *
 * @throws {AppError} `password_mismatch` | `validation_failed` | `email_taken` |
 *         `deletion_pending` | `rate_limited`
 */
export function requestEmailChange(
  user: UserRow,
  input: EmailChangeRequest,
  context: { ip: string; requestId: string; audit: AuditContext },
): EmailChangePending {
  const db = getDb()
  const now = Date.now()
  const newNormalized = normalizeEmail(input.newEmail)

  if (newNormalized === user.email_normalized) {
    throw new AppError(ERROR_CODE.validationFailed, '新邮箱与当前邮箱相同', {
      details: { fields: [{ path: 'newEmail', message: '新邮箱与当前邮箱相同' }] },
    })
  }
  if (deletionRepo.findLiveByUser(db, user.id)) {
    throw new AppError(ERROR_CODE.deletionPending, '注销流程进行中，暂不能更换邮箱')
  }
  if (usersRepo.emailExists(db, newNormalized, user.id)) {
    throw new AppError(ERROR_CODE.emailTaken, '该邮箱已被其他账号使用')
  }

  /**
   * A change of address requires mail twice over (the link to the new address and
   * the notice to the old one). On a deployment without SMTP neither can be sent,
   * so the request would create a pending change that can never be confirmed — the
   * user would be stuck on the old address until the token expired. Refuse before
   * minting anything, and point them at the administrator.
   */
  if (!mailService.isMailEnabled()) throw errors.mailDisabled()

  const live = tokensRepo.findLive(db, user.id, 'change_email')
  if (live && live.created_at > now - 10 * 60 * 1000) {
    throw errors.rateLimited(Math.ceil((live.created_at + 10 * 60 * 1000 - now) / 1000))
  }

  const hours = ttlHours('mail.emailChangeTtlHours')
  const expiresAt = now + hours * 60 * 60 * 1000
  const token = newToken()

  tokensRepo.issue(db, {
    id: newId(),
    userId: user.id,
    purpose: 'change_email',
    emailNormalized: newNormalized,
    tokenHash: hashToken(getConfig().sessionSecret, token),
    expiresAt,
    ip: context.ip,
    now,
  })

  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'change-email-confirm',
    to: newNormalized,
    locale,
    userId: user.id,
    params: {
      displayName: user.display_name,
      maskedEmail: maskEmail(newNormalized),
      link: buildVerifyUrl(token),
      expiresIn: expiresInLabel(hours, locale),
    },
  })
  mailService.queueInBackground({
    template: 'email-change-notice',
    to: user.email,
    locale,
    userId: user.id,
    params: { displayName: user.display_name, maskedEmail: maskEmail(newNormalized) },
  })

  auditService.record(context.audit, {
    action: 'user.email_change_requested',
    targetType: 'user',
    targetId: user.id,
    metadata: { to: maskEmail(newNormalized) },
  })

  return { pendingEmail: maskEmail(newNormalized), expiresAt: new Date(expiresAt).toISOString() }
}

/** Cancel a pending change. `404 not_found` when there is nothing to cancel. */
export function cancelEmailChange(user: UserRow, actor: AuditContext): void {
  const db = getDb()
  const live = tokensRepo.findLive(db, user.id, 'change_email')
  if (!live) throw errors.notFound('没有待确认的换邮箱申请')
  // Purpose-scoped on purpose: `invalidateAllForUser` would also void an
  // outstanding `verify` link, i.e. cancelling an address change would silently
  // break the verification mail for the address the user already owns.
  tokensRepo.invalidateForUserPurpose(db, user.id, 'change_email', Date.now())
  auditService.record(actor, {
    action: 'user.email_change_cancelled',
    targetType: 'user',
    targetId: user.id,
    metadata: {},
  })
}

/** Masked pending address for `/me`; null when no change is in flight. */
export function pendingEmail(userId: string): string | null {
  const live = tokensRepo.findLive(getDb(), userId, 'change_email')
  if (!live || live.expires_at <= Date.now()) return null
  return maskEmail(live.email_normalized)
}

/**
 * "A new device signed in" notice.
 *
 * Only when the device really is new: the last five device keys of the account
 * are compared, so a daily sign-in from the same laptop does not mail anything.
 * Failures are invisible by construction (`queueInBackground`), because a
 * notification must never affect authentication.
 */
export function notifyNewDevice(
  user: UserRow,
  device: { name: string; platform: string; appVersion: string; deviceKey: string },
  recentDeviceKeys: readonly string[],
): void {
  if (!settingsService.getBoolean('mail.notifyNewDevice')) return
  // Only a desktop client presents a device key; a browser login is not a new
  // machine and must not generate a security mail.
  if (device.deviceKey === '') return
  if (recentDeviceKeys.includes(device.deviceKey)) return
  if (user.email_verified_at === null) return
  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'new-device',
    to: user.email,
    locale,
    userId: user.id,
    params: {
      displayName: user.display_name,
      deviceName: device.name,
      platform: device.platform,
      appVersion: device.appVersion,
    },
  })
  log('info', 'new device notice queued', { userId: user.id })
}

/** "Your password changed" notice, gated by the same style of switch. */
export function notifyPasswordChanged(user: UserRow): void {
  if (!settingsService.getBoolean('mail.notifyPasswordChange')) return
  if (user.email_verified_at === null) return
  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'password-changed',
    to: user.email,
    locale,
    userId: user.id,
    params: { displayName: user.display_name },
  })
}

/** Mail the "your account is scheduled" note after a confirmation. */
export function notifyDeletionScheduled(
  user: UserRow,
  scheduledFor: number | null,
  includeCancelLink: boolean,
): void {
  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'deletion-scheduled',
    to: user.email,
    locale,
    userId: user.id,
    params: {
      displayName: user.display_name,
      link: includeCancelLink ? buildAccountUrl() : '',
      scheduledFor: scheduledFor ? new Date(scheduledFor).toLocaleString(locale) : undefined,
    },
  })
}

/** Mail the "nothing was removed" note after a cancellation. */
export function notifyDeletionCancelled(user: UserRow): void {
  const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
  mailService.queueInBackground({
    template: 'deletion-cancelled',
    to: user.email,
    locale,
    userId: user.id,
    params: { displayName: user.display_name },
  })
}

export async function verifyPasswordOrFail(user: UserRow, password: string): Promise<void> {
  const matches = await verifyPassword(password, user.password_hash)
  if (!matches) throw new AppError(ERROR_CODE.passwordMismatch, '口令不正确')
}
