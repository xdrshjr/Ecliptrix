import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { createRoleSchema } from '@/server/validation/schemas'
import * as roleService from '@/server/services/roleService'

/** `/api/v1/admin/roles` — list with permissions and user counts, and create. */
export const dynamic = 'force-dynamic'

function toRoleDto(role: ReturnType<typeof roleService.listRoles>[number]): Record<string, unknown> {
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

export const GET = withContext(async ({ request, context }) => {
  requireAdminRead(request, context, 'roles.read')
  return ok({ items: roleService.listRoles().map(toRoleDto) })
})

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'roles.write')
  const input = await readJson(request, createRoleSchema)

  const role = roleService.createRole(
    { key: input.key, name: input.name, description: input.description },
    auth.audit,
  )
  return ok({ role: toRoleDto(role) }, { status: 201 })
})
