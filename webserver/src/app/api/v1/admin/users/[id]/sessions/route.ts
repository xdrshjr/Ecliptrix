import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import * as authorityService from '@/server/services/authorityService'
import * as sessionService from '@/server/services/sessionService'
import { toSessionDto } from '@/server/db/types'

/**
 * `GET /api/v1/admin/users/{id}/sessions` — one user's devices and their state.
 *
 * Read-only, but gated by INV-1 anyway (review R-V4-02): the list carries device
 * names, masked addresses and last-seen times, which is reconnaissance. Letting a
 * rank-40 support account see where the root administrator is signed in is the
 * same mistake as handing it `security.read` — and the same reasoning as R-V4-02's
 * revoke gate, since reading and revoking are two halves of the same surface.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminRead(request, context, 'sessions.revoke')
    authorityService.assertCanRevokeSessionsOf(auth.audit.actorUserId, id)
    const rows = sessionService.listForUser(id)
    return ok({ items: rows.map((row) => toSessionDto(row)), total: rows.length })
  })(request)
}
