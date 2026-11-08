import { withContext, ok, readJson } from '@/server/http/route'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import { emailChangeSchema } from '@/server/validation/schemas'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { AppError, errors } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import { verifyPassword } from '@/server/auth/password'

/**
 * `/api/v1/me/email/change` — start or cancel a change of address.
 *
 * `POST` sends TWO mails: a confirmation link to the new address and a heads-up to
 * the current one. Verifying only the new address cannot stop somebody with a
 * stolen session from moving the account to their own mailbox and then using
 * "forgot password"; the notice to the old address is the only early warning the
 * real owner gets.
 *
 * The password is required because an address change is an account takeover
 * primitive.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const perUser = hit(
    'mail:change-email',
    auth.user.id,
    LIMITS.mailChangeEmail.limit,
    LIMITS.mailChangeEmail.windowMs,
  )
  if (!perUser.allowed) throw errors.rateLimited(perUser.retryAfterSeconds)

  const input = await readJson(request, emailChangeSchema)
  const matches = await verifyPassword(input.password, auth.user.password_hash)
  if (!matches) throw new AppError(ERROR_CODE.passwordMismatch, '口令不正确')

  const result = emailVerificationService.requestEmailChange(
    auth.user,
    { password: input.password, newEmail: input.newEmail },
    { ip: context.ip, requestId: context.requestId, audit: auth.audit },
  )
  return ok(result, { status: 202 })
})

/** `DELETE` cancels a pending change. */
export const DELETE = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  emailVerificationService.cancelEmailChange(auth.user, auth.audit)
  return ok({ cancelled: true })
})
