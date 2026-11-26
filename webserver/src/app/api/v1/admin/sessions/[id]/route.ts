import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { errors } from '@/server/http/errors'
import * as authorityService from '@/server/services/authorityService'
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
    // INV-1, entry #10 (review R-V4-02): forcing a device offline removes a
    // person's ability to act, so it is subject to the same level gate as a
    // suspension. `support` holds `sessions.revoke`, and without this line a
    // rank-40 help-desk account could eject the rank-100 owner. An actor may
    // always clear its own device — that is a sign-out, not governance.
    authorityService.assertCanRevokeSessionsOf(auth.audit.actorUserId, session.user_id)
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
