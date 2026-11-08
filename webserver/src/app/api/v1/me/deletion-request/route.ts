import { withContext, ok, readOptionalJson } from '@/server/http/route'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import { deletionRequestSchema } from '@/server/validation/schemas'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import * as profileService from '@/server/services/profileService'
import * as accountDeletionService from '@/server/services/accountDeletionService'

/**
 * `/api/v1/me/deletion-request` — start or cancel a real account deletion.
 *
 * `POST` opens the state machine (spec §3.8): with mail configured it parks at
 * `awaiting_confirmation` and mails a link; without mail it goes straight to
 * `scheduled` and the grace period starts, because requiring a confirmation mail
 * nobody can receive would mean "you cannot close your account at all".
 *
 * The password is mandatory. A stolen session must not be enough to destroy an
 * account, and the request itself is the moment the user still has a chance to
 * change their mind — after the grace period it is irreversible.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const limit = hit(
    'mail:deletion',
    auth.user.id,
    LIMITS.mailDeletion.limit,
    LIMITS.mailDeletion.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const input = await readOptionalJson(request, deletionRequestSchema)
  const result = await profileService.requestAccountDeletion(
    auth.user.id,
    { password: input.password, reason: input.reason },
    { ip: context.ip, requestId: context.requestId, audit: auth.audit },
  )
  return ok(result, { status: 202 })
})

/** `DELETE` cancels the live request. `404` when there is nothing to cancel. */
export const DELETE = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  accountDeletionService.cancel(auth.user, auth.audit)
  return ok({ cancelled: true })
})
