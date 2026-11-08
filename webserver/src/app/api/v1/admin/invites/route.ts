import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { createInviteSchema } from '@/server/validation/schemas'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import * as inviteService from '@/server/services/inviteService'
import { localeFromRequest } from '@/lib/locale'

/**
 * `/api/v1/admin/invites` — list (hint only) and create (plaintext once).
 *
 * `POST` gained two optional fields: `email` mails the invitation and `note` is
 * kept for the audit row. Without `email` the response is byte-for-byte what it
 * was (`{ invite }` plus a `mail: null`), so an existing console keeps working.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  requireAdminRead(request, context, 'invites.read')
  return ok({ items: inviteService.listInvites() })
})

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'invites.write')
  const input = await readJson(request, createInviteSchema)

  if (input.email) {
    // Invitations are the one mail stream whose daily cap is per ADMIN, not per
    // recipient: the recipient may not have an account yet (spec §3.3 note).
    const limit = hit(
      'mail:invite',
      auth.user.id,
      LIMITS.mailInvite.limit,
      LIMITS.mailInvite.windowMs,
    )
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)
  }

  const locale = localeFromRequest(request)
  const created = await inviteService.createInvite(
    {
      maxUses: input.maxUses,
      expiresInDays: input.expiresInDays,
      roleKey: input.roleKey,
      email: input.email,
      note: input.note,
    },
    auth.audit,
    locale,
  )
  return ok(
    { invite: created, mail: created.mail },
    {
      status: 201,
      message: input.email
        ? '邀请码只显示这一次，已发送到收件邮箱'
        : '邀请码只显示这一次，请立即复制',
    },
  )
})
