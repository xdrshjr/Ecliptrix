import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { createInviteSchema } from '@/server/validation/schemas'
import * as inviteService from '@/server/services/inviteService'

/** `/api/v1/admin/invites` — list (hint only) and create (plaintext once). */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  requireAdminRead(request, context, 'invites.read')
  return ok({ items: inviteService.listInvites() })
})

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'invites.write')
  const input = await readJson(request, createInviteSchema)

  const created = inviteService.createInvite(
    {
      maxUses: input.maxUses,
      expiresInDays: input.expiresInDays,
      roleKey: input.roleKey,
    },
    auth.audit,
  )
  return ok(
    { invite: created },
    { status: 201, message: '邀请码只显示这一次，请立即复制' },
  )
})
