import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminWrite, requirePermission } from '@/server/auth/guards'
import { bulkActionSchema } from '@/server/validation/schemas'
import * as userService from '@/server/services/userService'

/**
 * `POST /api/v1/admin/users/bulk`
 *
 * Partial success is the contract: one protected row must not abort the batch.
 * The response lists exactly what was applied and why anything was skipped, so
 * the console can show a truthful toast instead of "something failed".
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'users.write')
  const input = await readJson(request, bulkActionSchema)
  if (input.action === 'setRole') {
    // §2.9.12 applies to every roleId change, batched or not: a role assignment
    // is a permission grant, so it needs the role-authoring permission too.
    // Plain `requirePermission`, not the write guard — the CSRF check and the
    // budget were already settled above and must not be charged twice.
    requirePermission(request, context, 'roles.write')
  }

  const result = userService.bulk(
    auth.user.id,
    { action: input.action, ids: input.ids, roleId: input.roleId },
    auth.audit,
  )
  return ok(result)
})
