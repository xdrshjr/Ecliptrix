import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import * as inviteService from '@/server/services/inviteService'

/** `DELETE /api/v1/admin/invites/{id}` — revoke a code (kept for the audit trail). */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'invites.write')
    inviteService.revokeInvite(id, auth.audit)
    return ok({ revoked: true, inviteId: id })
  })(request)
}
