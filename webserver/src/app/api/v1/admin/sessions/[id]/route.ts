import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { errors } from '@/server/http/errors'
import * as sessionService from '@/server/services/sessionService'
import * as auditService from '@/server/services/auditService'

/** `DELETE /api/v1/admin/sessions/{id}` — force a device offline. */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'sessions.revoke')

    const session = sessionService.sessionFromId(id)
    if (!session) throw errors.notFound('会话不存在')
    if (session.revoked_at !== null) {
      return ok({ revoked: false, alreadyRevoked: true, sessionId: id })
    }

    sessionService.revokeOne(id, 'admin_revoked')
    auditService.record(auth.audit, {
      action: 'session.revoke',
      targetType: 'session',
      targetId: id,
      metadata: { userId: session.user_id, device: session.device_name },
    })
    return ok({ revoked: true, sessionId: id })
  })(request)
}
