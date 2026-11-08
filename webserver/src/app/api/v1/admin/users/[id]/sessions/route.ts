import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import * as sessionService from '@/server/services/sessionService'
import { toSessionDto } from '@/server/db/types'

/** `GET /api/v1/admin/users/{id}/sessions` — one user's devices and their state. */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    requireAdminRead(request, context, 'sessions.revoke')
    const rows = sessionService.listForUser(id)
    return ok({ items: rows.map((row) => toSessionDto(row)), total: rows.length })
  })(request)
}
