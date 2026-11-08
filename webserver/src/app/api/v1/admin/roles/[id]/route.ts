import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { updateRoleSchema } from '@/server/validation/schemas'
import * as roleService from '@/server/services/roleService'

/** `PATCH|DELETE /api/v1/admin/roles/{id}` — rename, or delete an unused role. */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

function toRoleDto(role: ReturnType<typeof roleService.getRole>): Record<string, unknown> {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.is_system === 1,
    permissions: role.permissions,
    userCount: role.user_count,
    createdAt: new Date(role.created_at).toISOString(),
  }
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'roles.write')
    const input = await readJson(request, updateRoleSchema)
    return ok({ role: toRoleDto(roleService.updateRole(id, input, auth.audit)) })
  })(request)
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'roles.write')
    roleService.deleteRole(id, auth.audit)
    return ok({ deleted: true, roleId: id })
  })(request)
}
