import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import * as userService from '@/server/services/userService'

/**
 * `POST /api/v1/admin/users/{id}/unlock` — clear a lockout immediately.
 *
 * Goes through the shared admin-write guard like every other write: this endpoint
 * is a credential control (it erases the exponential lockout), so it must not be
 * the one admin mutation reachable by a cross-site request.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')
    userService.unlockUser(id, auth.audit)
    return ok({ unlocked: true, userId: id })
  })(request)
}
