import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { adminSessionsRevokeSchema } from '@/server/validation/schemas'
import * as adminSessionService from '@/server/services/adminSessionService'
import * as auditService from '@/server/services/auditService'

/**
 * `POST /api/v1/admin/sessions/revoke` — kick up to 100 devices at once.
 *
 * `sessions.revoke` (which `support` also holds — that is the existing role design,
 * not a bug). ONE aggregated audit row is written for the whole batch: a single
 * click that writes 100 rows makes the log useless for the investigation it exists
 * for, and `metadata.count` carries the number.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'sessions.revoke')
  const input = await readJson(request, adminSessionsRevokeSchema)

  const result = adminSessionService.revokeMany(input.ids, input.reason)

  auditService.record(auth.audit, {
    action: 'admin.sessions_revoked',
    targetType: 'session',
    metadata: { count: result.revoked, skipped: result.skipped, reason: result.reason },
  })

  return ok({ revoked: result.revoked, skipped: result.skipped })
})
