import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite, requireOwner, requirePermission } from '@/server/auth/guards'
import { updateUserSchema } from '@/server/validation/schemas'
import { toAdminUserDto } from '@/server/http/dto'
import * as userService from '@/server/services/userService'
import * as sessionService from '@/server/services/sessionService'
import { toSessionDto } from '@/server/db/types'

/**
 * `/api/v1/admin/users/{id}`
 *
 * GET detail (profile + role + permissions + live sessions), PATCH to update,
 * DELETE to soft-delete (`?hard=true` is owner-only and audited).
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    requireAdminRead(request, context, 'users.read')
    const detail = userService.getUserDetail(id)
    const sessions = sessionService.listForUser(id)
    return ok({
      user: toAdminUserDto(detail),
      sessions: sessions.map((row) => toSessionDto(row)),
    })
  })(request)
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')

    const input = await readJson(request, updateUserSchema)
    if (input.roleId !== undefined) {
      // Changing somebody's role re-grants permissions: require both. Plain
      // `requirePermission` because CSRF and the budget are already settled.
      requirePermission(request, context, 'roles.write')
    }
    userService.updateUser(auth.user.id, id, input, auth.audit)
    return ok({ user: toAdminUserDto(userService.getUserDetail(id)) })
  })(request)
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context, searchParams }) => {
    const hard = searchParams.get('hard') === 'true'
    // Spec §4.2: the endpoint itself is gated on `users.delete` for both modes —
    // a role holding only `users.write` must not be able to delete anything. On
    // top of that, a physical delete (no audit trail of the row survives, no
    // recovery) is reserved for the owner.
    const auth = requireAdminWrite(request, context, 'users.delete')
    if (hard) requireOwner(auth, '永久删除账号')
    userService.deleteUser(auth.user.id, id, { hard }, auth.audit)
    return ok({ deleted: true, hard })
  })(request)
}
