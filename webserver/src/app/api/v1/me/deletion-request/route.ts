import { withContext, ok } from '@/server/http/route'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import * as profileService from '@/server/services/profileService'

/**
 * `POST /api/v1/me/deletion-request` — record an account-deletion request.
 *
 * The account is *not* deleted: the console's danger zone only signals intent,
 * which lands in the audit log so an administrator can act on it. Self-service
 * hard deletion is out of scope for this release (spec §3.10 DangerZone).
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  profileService.requestAccountDeletion(auth.user.id, auth.audit)
  return ok({ requested: true })
})
