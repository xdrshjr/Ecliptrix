import { randomBytes } from 'node:crypto'
import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as deletionRepo from '@/server/db/repositories/deletionRequestsRepo'
import * as tokensRepo from '@/server/db/repositories/emailActionTokensRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as resetsRepo from '@/server/db/repositories/passwordResetsRepo'
import { ERROR_CODE, REVOKE_REASON } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import { hashToken, newId, newToken } from '@/server/auth/tokens'
import { verifyPassword } from '@/server/auth/password'
import * as auditService from '@/server/services/auditService'
import * as authorityService from '@/server/services/authorityService'
import * as mailService from '@/server/services/mailService'
import * as settingsService from '@/server/services/settingsService'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import { maskEmail, shortId } from '@/server/services/privacy'
import { buildDeletionUrl } from '@/server/mail/links'
import { translator, type Locale } from '@/lib/i18n'
import { log } from '@/server/http/requestContext'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * Real account deletion.
 *
 * The design decision that shapes everything here: **anonymise, never delete the
 * row**. `users.status = 'deleted'` plus a tombstone address keeps the audit trail
 * and the role history intact (a hard delete would orphan `audit_events` and hit
 * the foreign keys that `ON DELETE SET NULL` only partly covers).
 *
 * Flow (spec §3.8):
 *   request → awaiting_confirmation (mailed link) → scheduled (+grace) → completed
 *                   ↘ cancelled ↙                ↘ cancelled ↗
 * With no SMTP the request goes straight to `scheduled`: requiring a mail nobody
 * can receive would mean "you cannot close your account", which is worse than the
 * weakened proof (the request already needs a password + a live session).
 */

const HOUR_MS = 60 * 60 * 1000

export interface DeletionRequestInput {
  password: string
  reason?: string
}

export interface DeletionRequestResult {
  requestId: string
  requiresConfirmation: boolean
  scheduledFor: string | null
}

/**
 * Guard: who may not delete themselves.
 *
 * `owner` is protected outright (same rule as suspension and demotion), and so is
 * the last account that can administer users — otherwise the installation ends up
 * with nobody able to restore anybody.
 */
function assertDeletable(user: UserRow): void {
  const db = getDb()
  const role = rolesRepo.findById(db, user.role_id)
  if (role?.key === 'owner') {
    throw new AppError(ERROR_CODE.cannotModifyOwner, '超级管理员账号不能注销')
  }
  if (user.status === 'suspended') {
    throw new AppError(ERROR_CODE.accountSuspended, '账号已被停用，请先联系管理员恢复')
  }
  if (role) {
    const permissions = rolesRepo.permissionsFor(db, role.id)
    const canAdminister =
      permissions.includes('*') ||
      permissions.includes('users.write') ||
      permissions.includes('users.delete')
    if (canAdminister) {
      const rows = db.prepare('SELECT id, role_id FROM users WHERE status <> ?').all('deleted') as {
        id: string
        role_id: string
      }[]
      const others = rows.filter((row) => row.id !== user.id).filter((row) => {
        const otherRole = rolesRepo.findById(db, row.role_id)
        if (!otherRole) return false
        const otherPermissions = rolesRepo.permissionsFor(db, otherRole.id)
        return (
          otherPermissions.includes('*') ||
          otherPermissions.includes('users.write') ||
          otherPermissions.includes('users.delete')
        )
      })
      if (others.length === 0) {
        throw new AppError(
          ERROR_CODE.conflict,
          '这是最后一位可管理用户的账号，请先把权限转交给其他人再注销',
        )
      }
    }
  }
}

/**
 * Start (or re-start) a deletion request.
 *
 * @throws {AppError} `password_mismatch` | `cannot_modify_owner` | `conflict` |
 *         `account_suspended` | `deletion_pending` (an active request exists)
 */
export function request(
  user: UserRow,
  input: DeletionRequestInput,
  context: { ip: string; requestId: string; audit: AuditContext },
  options: { allowExistingPending?: boolean } = {},
): DeletionRequestResult {
  const db = getDb()
  const now = Date.now()
  assertDeletable(user)

  if (!options.allowExistingPending) {
    const live = deletionRepo.findLiveByUser(db, user.id)
    if (live) {
      throw new AppError(ERROR_CODE.deletionPending, '已经存在进行中的注销申请', {
        details: { status: live.status, scheduledFor: live.scheduled_for },
      })
    }
  }

  const mailEnabled = mailService.isMailEnabled()
  const graceHours = settingsService.getNumber('account.deletionGraceHours')
  const scheduledFor = now + graceHours * HOUR_MS
  const token = mailEnabled ? newToken() : null
  const requestId = newId()

  const cancelled = deletionRepo.create(db, {
    id: requestId,
    userId: user.id,
    // NULL, never '': a second degraded request would collide on a shared ''.
    tokenHash: token ? hashToken(getConfig().sessionSecret, token) : null,
    reason: (input.reason ?? '').slice(0, 200),
    status: mailEnabled ? 'awaiting_confirmation' : 'scheduled',
    scheduledFor: mailEnabled ? null : scheduledFor,
    ip: context.ip,
    requestId: context.requestId,
    now,
  })

  auditService.record(context.audit, {
    action: 'account.deletion_requested',
    targetType: 'user',
    targetId: user.id,
    // Masked: a plaintext address in the audit log is a data leak with a
    // retention policy, not a record.
    metadata: {
      requiresConfirmation: mailEnabled,
      requestId,
      priorEmailMasked: maskEmail(user.email),
      cancelledPrior: cancelled.length,
    },
  })

  if (token) {
    const locale: Locale = user.locale === 'en-US' ? 'en-US' : 'zh-CN'
    const tt = translator(locale)
    mailService.queueInBackground({
      template: 'deletion-confirm',
      to: user.email,
      locale,
      userId: user.id,
      params: {
        displayName: user.display_name,
        link: buildDeletionUrl(token),
        expiresIn: tt('mail.duration.hours', { count: 48 }),
      },
    })
  } else {
    // Degraded deployment: record the scheduling mail as captured so the operator
    // still sees the event in the outbox.
    emailVerificationService.notifyDeletionScheduled(user, scheduledFor, true)
  }

  return {
    requestId,
    requiresConfirmation: mailEnabled,
    scheduledFor: mailEnabled ? null : new Date(scheduledFor).toISOString(),
  }
}

/** Cancel a live request. `404 not_found` when there is nothing to cancel. */
export function cancel(user: UserRow, actor: AuditContext): void {
  const db = getDb()
  const live = deletionRepo.findLiveByUser(db, user.id)
  if (!live) throw errors.notFound('没有进行中的注销申请')
  deletionRepo.markCancelled(db, live.id, Date.now())
  auditService.record(actor, {
    action: 'account.deletion_cancelled',
    targetType: 'user',
    targetId: user.id,
    metadata: {},
  })
  emailVerificationService.notifyDeletionCancelled(user)
}

/**
 * Consume a mailed confirmation link.
 *
 * @throws {AppError} `token_invalid` when the token is unknown/expired/already
 *         used, `conflict` when the request was cancelled or already executed.
 */
export function confirm(token: string, context: { ip: string; requestId: string }): {
  scheduledFor: string
} {
  const db = getDb()
  const now = Date.now()
  const row = deletionRepo.findByTokenHash(db, hashToken(getConfig().sessionSecret, token))
  if (!row) throw errors.tokenInvalid()
  if (row.status === 'cancelled' || row.status === 'completed') {
    throw new AppError(ERROR_CODE.conflict, '该注销申请已失效')
  }
  const user = usersRepo.findById(db, row.user_id)
  if (!user || user.status !== 'active') throw errors.tokenInvalid()

  // Already confirmed: answer with the original deadline instead of recomputing it.
  // `now + grace` on every click turns a single-use link into a "postpone forever"
  // button, and re-mails the user each time. `markScheduled` has already cleared
  // `token_hash`, so this only covers the row confirmed before that change.
  if (row.status === 'scheduled' && row.scheduled_for !== null) {
    return { scheduledFor: new Date(row.scheduled_for).toISOString() }
  }

  const graceHours = settingsService.getNumber('account.deletionGraceHours')
  const scheduledFor = now + graceHours * HOUR_MS
  deletionRepo.markScheduled(db, row.id, { scheduledFor, now })

  auditService.record(
    { actorUserId: user.id, actorLabel: user.email, ip: context.ip, requestId: context.requestId },
    {
      action: 'account.deletion_scheduled',
      targetType: 'user',
      targetId: user.id,
      metadata: { scheduledFor: new Date(scheduledFor).toISOString() },
    },
  )
  emailVerificationService.notifyDeletionScheduled(user, scheduledFor, true)
  return { scheduledFor: new Date(scheduledFor).toISOString() }
}

/**
 * Administrator on-behalf confirmation (P1-11).
 *
 * A user who lost access to the mailbox must not be trapped in an account they
 * cannot close. Same grace period, same audit trail — only the "click the link"
 * step is replaced by an operator decision with a stated reason.
 */
export function confirmByAdmin(
  userId: string,
  reason: string,
  actor: AuditContext,
): { status: 'scheduled'; scheduledFor: string } {
  const db = getDb()
  const now = Date.now()
  const user = usersRepo.findById(db, userId)
  if (!user) throw errors.notFound('用户不存在')
  assertDeletable(user)
  // INV-1, entry #4 (review R-V3-03). `assertDeletable` only refuses the owner and
  // the last manageable account; it compares nothing about the caller. Closing
  // somebody's account is the terminal weakening action, so an `admin` must not be
  // able to do it to a peer — otherwise the "protect the owner" rule is the only
  // rule, and two administrators can remove each other.
  authorityService.assertRankAbove(actor.actorUserId, userId)

  const live = deletionRepo.findLiveByUser(db, userId)
  if (!live) {
    throw new AppError(ERROR_CODE.conflict, '该账号没有进行中的注销申请')
  }
  const graceHours = settingsService.getNumber('account.deletionGraceHours')
  const scheduledFor = live.status === 'scheduled' && live.scheduled_for
    ? live.scheduled_for
    : now + graceHours * HOUR_MS
  deletionRepo.markScheduled(db, live.id, { scheduledFor, now })

  auditService.record(actor, {
    action: 'account.deletion_confirmed_by_admin',
    targetType: 'user',
    targetId: userId,
    metadata: { reason: reason.slice(0, 200), scheduledFor: new Date(scheduledFor).toISOString() },
  })
  emailVerificationService.notifyDeletionScheduled(user, scheduledFor, true)
  return { status: 'scheduled', scheduledFor: new Date(scheduledFor).toISOString() }
}

export interface SweepResult {
  scanned: number
  deleted: number
  failed: number
}

/**
 * Anonymise one account. Runs inside the caller's transaction.
 *
 * The tombstone values are derived from the user id (a UUID), so two accounts
 * cannot collide on `email_normalized` / `username_normalized` — R4 in the risk
 * table. The password becomes 48 random bytes, which no input can match.
 */
function anonymise(user: UserRow, now: number): { sessionsRevoked: number } {
  const db = getDb()
  const suffix = shortId(user.id)
  const randomPassword = randomBytes(48).toString('base64')

  usersRepo.update(
    db,
    user.id,
    {
      status: 'deleted',
      deleted_at: now,
      email: `deleted+${suffix}@deleted.invalid`,
      email_normalized: `deleted+${suffix}@deleted.invalid`,
      username: `deleted_${suffix}`,
      username_normalized: `deleted_${suffix}`,
      display_name: '已注销账号',
      password_hash: randomPassword,
      password_updated_at: now,
      avatar_url: null,
      note: '',
      must_change_password: 0,
      locked_until: null,
      failed_login_count: 0,
      lock_count: 0,
      email_verified_at: null,
      last_exported_at: null,
    } as Partial<UserRow>,
    now,
  )

  const sessionsRevoked = sessionsRepo.revokeAllForUser(
    db,
    user.id,
    now,
    REVOKE_REASON.accountDeleted,
  )
  tokensRepo.invalidateAllForUser(db, user.id, now)
  resetsRepo.invalidateAllForUser(db, user.id, now)
  return { sessionsRevoked }
}

/**
 * Execute every request whose grace period has elapsed.
 *
 * Each row is its own transaction: one stubborn account must not block the queue.
 * A failure is logged and counted, never re-thrown — this runs on the request path
 * (`withContext`) and an operator's pending deletion is not a reason to fail an
 * unrelated request.
 */
export function sweepDue(now = Date.now(), limit = 200): SweepResult {
  const db = getDb()
  const due = deletionRepo.listDue(db, now, limit)
  const result: SweepResult = { scanned: due.length, deleted: 0, failed: 0 }

  for (const request of due) {
    try {
      const user = usersRepo.findById(db, request.user_id)
      if (!user) {
        deletionRepo.markCompleted(db, request.id, now)
        continue
      }
      const run = db.transaction(() => {
        const priorEmail = user.email
        const { sessionsRevoked } = anonymise(user, now)
        deletionRepo.markCompleted(db, request.id, now)
        return { priorEmail, sessionsRevoked }
      })
      const { priorEmail, sessionsRevoked } = run()
      result.deleted += 1
      auditService.record(auditService.SYSTEM_ACTOR, {
        action: 'account.deleted',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          priorEmailMasked: maskEmail(priorEmail),
          sessionsRevoked,
          requestId: request.request_id,
        },
      })
      // The last mail this address ever receives.
      mailService.queueInBackground({
        template: 'deletion-completed',
        to: priorEmail,
        locale: user.locale === 'en-US' ? 'en-US' : 'zh-CN',
        userId: user.id,
        params: { displayName: user.display_name },
      })
    } catch (error) {
      result.failed += 1
      log('error', 'account deletion sweep failed', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** Public view of the live request for `/me`. */
export function liveForUser(
  userId: string,
): { status: 'awaiting_confirmation' | 'scheduled'; scheduledFor: string | null } | null {
  const live = deletionRepo.findLiveByUser(getDb(), userId)
  if (!live) return null
  if (live.status !== 'awaiting_confirmation' && live.status !== 'scheduled') return null
  return {
    status: live.status,
    scheduledFor: live.scheduled_for ? new Date(live.scheduled_for).toISOString() : null,
  }
}

/** Password check used by the request endpoint (separate from the guard). */
export async function assertPassword(user: UserRow, password: string): Promise<void> {
  const matches = await verifyPassword(password, user.password_hash)
  if (!matches) throw new AppError(ERROR_CODE.passwordMismatch, '口令不正确')
}

export { deletionRepo }
