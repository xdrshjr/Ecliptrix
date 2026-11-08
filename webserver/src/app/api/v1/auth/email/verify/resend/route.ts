import { withContext, ok } from '@/server/http/route'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import * as emailVerificationService from '@/server/services/emailVerificationService'
import { localeFromRequest } from '@/lib/locale'

/**
 * `POST /api/v1/auth/email/verify/resend` — send the verification link again.
 *
 * Two budgets: 3/hour per account (a person clicking twice) and 10/hour per source
 * address (a script cycling accounts). Both live in `LIMITS`.
 *
 * `503 mail_disabled` when the deployment has no SMTP: unlike the reset and
 * deletion paths there is no degraded fallback — verification is *only* possible
 * by receiving the mail, so answering `202` would be a lie.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const perUser = hit(
    'mail:verify-resend',
    auth.user.id,
    LIMITS.mailVerifyResend.limit,
    LIMITS.mailVerifyResend.windowMs,
  )
  if (!perUser.allowed) throw errors.rateLimited(perUser.retryAfterSeconds)
  const perIp = hit(
    'mail:verify-resend-ip',
    context.ip,
    LIMITS.mailVerifyResendIp.limit,
    LIMITS.mailVerifyResendIp.windowMs,
  )
  if (!perIp.allowed) throw errors.rateLimited(perIp.retryAfterSeconds)

  const locale = localeFromRequest(request)
  const result = emailVerificationService.resendVerification(auth.user, {
    ip: context.ip,
    locale,
    audit: auth.audit,
  })
  return ok(result, { status: 202 })
})
