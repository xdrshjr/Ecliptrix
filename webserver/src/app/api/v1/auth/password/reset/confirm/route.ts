import { withContext, ok, readJson } from '@/server/http/route'
import { resetConfirmSchema } from '@/server/validation/schemas'
import { errors } from '@/server/http/errors'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'

/** `POST /api/v1/auth/password/reset/confirm` — spend a one-time reset token. */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const input = await readJson(request, resetConfirmSchema)

  // Its own scope: a typo in the token must never spend the budget that the
  // sibling `request` endpoint needs to send a fresh link.
  const limit = hit(
    'reset:confirm:ip',
    context.ip,
    LIMITS.resetConfirmIp.limit,
    LIMITS.resetConfirmIp.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  await authService.confirmPasswordReset(input.token, input.newPassword, {
    ip: context.ip,
    requestId: context.requestId,
  })

  return ok({ reset: true })
})
