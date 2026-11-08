import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { toAdminUserDto } from '@/server/http/dto'
import * as userService from '@/server/services/userService'

/**
 * `POST /api/v1/admin/users/{id}/restore`
 *
 * Soft deletion rewrites the unique email/username to a tombstone, so restoring
 * needs the originals back from the audit trail. When the address has since been
 * taken the caller gets `email_taken` and must pick a new one first — silently
 * reusing an address would hand the wrong person the account.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')
    userService.restoreUser(id, auth.audit)
    return ok({ restored: true, user: toAdminUserDto(userService.getUserDetail(id)) })
  })(request)
}
