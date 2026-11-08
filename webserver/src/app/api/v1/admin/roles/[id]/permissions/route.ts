import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { permissionsSchema } from '@/server/validation/schemas'
import * as roleService from '@/server/services/roleService'

/**
 * `PUT /api/v1/admin/roles/{id}/permissions`
 *
 * Full replacement, not a patch: the console's matrix submits the complete set,
 * so a partial body would silently strip everything it omitted. `owner` answers
 * `system_role_protected` — its set is generated as `['*']`.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PUT(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'roles.write')
    const input = await readJson(request, permissionsSchema)
    const role = roleService.replacePermissions(id, input.permissions, auth.audit)
    return ok({
      role: {
        id: role.id,
        key: role.key,
        name: role.name,
        permissions: role.permissions,
        userCount: role.user_count,
      },
      note: '权限变更对该角色用户的下一次请求立即生效，无需重新登录',
    })
  })(request)
}
