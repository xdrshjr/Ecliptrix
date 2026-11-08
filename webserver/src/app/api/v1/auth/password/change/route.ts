import { withContext, ok, readJson } from '@/server/http/route'
import { changePasswordSchema } from '@/server/validation/schemas'
import { requireSession } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import { isBearerRequest } from '@/server/auth/guards'
import * as authService from '@/server/services/authService'

/**
 * `POST /api/v1/auth/password/change`
 *
 * Allowed while `must_change_password` is set — it is the only endpoint a
 * temporary-password account can reach, which is what makes it temporary.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  const input = await readJson(request, changePasswordSchema)

  await authService.changePassword({
    userId: auth.user.id,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    signOutOtherSessions: input.signOutOtherSessions,
    currentSessionId: auth.session.id,
    requestId: context.requestId,
    ip: context.ip,
  })

  return ok({ changed: true, signedOutOthers: input.signOutOtherSessions })
})
