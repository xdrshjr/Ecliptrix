import { withContext, ok, readJson } from '@/server/http/route'
import { deletionConfirmSchema } from '@/server/validation/schemas'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import * as accountDeletionService from '@/server/services/accountDeletionService'

/**
 * `POST /api/v1/auth/deletion/confirm` — the user clicked the mailed link.
 *
 * Session-less like the verification consumer, and budgeted on the same scope for
 * the same reason: the token cannot be guessed, but the endpoint must not become
 * a free query amplifier.
 *
 * Confirming only SCHEDULES the deletion (`now + account.deletionGraceHours`), so
 * a mis-click is still recoverable from the account centre.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const limit = hit(
    'email:verify',
    context.ip,
    LIMITS.emailVerifyConsume.limit,
    LIMITS.emailVerifyConsume.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const input = await readJson(request, deletionConfirmSchema)
  const result = accountDeletionService.confirm(input.token, {
    ip: context.ip,
    requestId: context.requestId,
  })
  return ok(result)
})
