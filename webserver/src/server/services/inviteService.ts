import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as invitesRepo from '@/server/db/repositories/invitesRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import { codeHint, hashToken, newId, newInviteCode } from '@/server/auth/tokens'
import { ERROR_CODE } from '@/server/auth/constants'
import { AppError, errors } from '@/server/http/errors'
import * as auditService from '@/server/services/auditService'
import * as mailService from '@/server/services/mailService'
import { maskEmail } from '@/server/services/privacy'
import { buildInviteUrl } from '@/server/mail/links'
import { translator, type Locale } from '@/lib/i18n'
import type { AuditContext } from '@/server/services/auditService'
import type { InviteListRow } from '@/server/db/repositories/invitesRepo'

/**
 * Registration invites.
 *
 * The plaintext code exists exactly once — in the creation response, or in the
 * invitation mail. Only its HMAC digest is stored, so listing invites can never
 * re-display one, and a database leak does not hand out registration rights.
 *
 * That one-shot property is also why the invitation mail is `retryable = 0`: the
 * outbox keeps `code` only inside the already-redacted body, so a retry could not
 * reproduce the message.
 */

export interface CreatedInvite {
  id: string
  code: string
  codeHint: string
  roleKey: string
  maxUses: number
  expiresAt: string | null
}

export interface CreatedInviteWithMail extends CreatedInvite {
  /** Null when no address was supplied (the console still shows the code). */
  mail: { queued: boolean; id: string | null; status: string } | null
}

export interface CreateInviteInput {
  maxUses: number
  expiresInDays: number
  roleKey: string
  /** Optional recipient: when present the invitation is mailed. */
  email?: string
  note?: string
}

/**
 * Create an invite, and mail it when an address was supplied.
 *
 * @throws {AppError} `validation_failed` | `forbidden` | `unauthorized`
 */
export async function createInvite(
  input: CreateInviteInput,
  actor: AuditContext,
  locale: Locale = 'zh-CN',
): Promise<CreatedInviteWithMail> {
  const db = getDb()
  const now = Date.now()
  const role = rolesRepo.findByKey(db, input.roleKey)
  if (!role) throw new AppError(ERROR_CODE.validationFailed, '角色不存在')
  if (role.key === 'owner') {
    throw new AppError(ERROR_CODE.forbidden, '不能创建可注册为超级管理员的邀请码')
  }
  if (!actor.actorUserId) throw errors.unauthorized()

  const code = newInviteCode()
  const id = newId()
  invitesRepo.create(db, {
    id,
    codeHash: hashToken(getConfig().sessionSecret, code),
    codeHint: codeHint(code),
    createdBy: actor.actorUserId,
    roleId: role.id,
    maxUses: input.maxUses,
    expiresAt: input.expiresInDays > 0 ? now + input.expiresInDays * 24 * 60 * 60 * 1000 : null,
    now,
  })

  auditService.record(actor, {
    action: 'invite.create',
    targetType: 'invite',
    targetId: id,
    metadata: {
      roleKey: role.key,
      maxUses: input.maxUses,
      expiresInDays: input.expiresInDays,
      mailed: Boolean(input.email),
      // The operator's own words, kept here because there is nowhere else to put
      // them: an invite has no free-text column. Dropping it silently made the
      // route's "the note is kept for the audit row" comment a lie.
      note: input.note ? input.note.slice(0, 200) : null,
    },
  })

  const created = invitesRepo.findById(db, id)
  const base: CreatedInvite = {
    id,
    code,
    codeHint: codeHint(code),
    roleKey: role.key,
    maxUses: input.maxUses,
    expiresAt: created?.expires_at ? new Date(created.expires_at).toISOString() : null,
  }

  if (!input.email) return { ...base, mail: null }

  const tt = translator(locale)
  const queued = await mailService.queue({
    template: 'invite',
    to: input.email,
    locale,
    // Not tied to an account: the recipient may not exist yet. This is also why
    // the per-user daily cap does not cover invitations (the admin's own 60/hour
    // budget does, in the route).
    userId: null,
    params: {
      // Masked, like every other templated address: an unconfirmed address must
      // not be re-exposed in the outbox body or in `db:backup`.
      displayName: maskEmail(input.email),
      code,
      link: buildInviteUrl(code),
      expiresIn:
        input.expiresInDays > 0
          ? tt('mail.duration.days', { count: input.expiresInDays })
          : undefined,
    },
  })

  return { ...base, mail: { queued: true, id: queued.id, status: queued.status } }
}

export interface InviteDto {
  id: string
  codeHint: string
  roleKey: string
  roleName: string
  createdByLabel: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  state: 'active' | 'exhausted' | 'expired' | 'revoked'
}

function isExpired(row: InviteListRow, now: number): boolean {
  return row.expires_at !== null && row.expires_at <= now
}

export function toInviteDto(row: InviteListRow, now = Date.now()): InviteDto {
  let state: InviteDto['state'] = 'active'
  if (row.revoked_at !== null) state = 'revoked'
  else if (isExpired(row, now)) state = 'expired'
  else if (row.used_count >= row.max_uses) state = 'exhausted'

  return {
    id: row.id,
    codeHint: row.code_hint,
    roleKey: row.role_key,
    roleName: row.role_name,
    createdByLabel: row.created_by_label,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    state,
  }
}

export function listInvites(): InviteDto[] {
  const now = Date.now()
  return invitesRepo.listAll(getDb()).map((row) => toInviteDto(row, now))
}

export function revokeInvite(id: string, actor: AuditContext): void {
  const db = getDb()
  const invite = invitesRepo.findById(db, id)
  if (!invite) throw errors.notFound('邀请码不存在')
  invitesRepo.revoke(db, id, Date.now())
  auditService.record(actor, {
    action: 'invite.revoke',
    targetType: 'invite',
    targetId: id,
    metadata: { codeHint: invite.code_hint },
  })
}
