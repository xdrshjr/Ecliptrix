import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import * as userService from '@/server/services/userService'

/**
 * `POST /api/v1/admin/users/{id}/email-verify` — mark an address verified.
 *
 * The escape hatch for "the user genuinely cannot receive mail" (wrong address,
 * aggressive spam filter, corporate relay). It writes
 * `user.email_verified_by_admin` so the user can see that an administrator let them
 * in, rather than finding a mystery state.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')
    const result = userService.markEmailVerified(id, auth.audit)
    return ok(result)
  })(request)
}
