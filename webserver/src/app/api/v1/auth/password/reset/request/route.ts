import { withContext, ok, readJson } from '@/server/http/route'
import { resetRequestSchema } from '@/server/validation/schemas'
import { errors } from '@/server/http/errors'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import { buildResetUrl, sendPasswordResetMail } from '@/server/mail/mailer'
import { log } from '@/server/http/requestContext'

/**
 * `POST /api/v1/auth/password/reset/request`
 *
 * Always answers `202` with an empty body, whether or not the address exists and
 * whether or not mail is configured. Anything else would turn this endpoint into
 * an account-enumeration oracle (spec §2.9 item 8).
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const input = await readJson(request, resetRequestSchema)

  const limit = hit('reset:ip', context.ip, LIMITS.resetIp.limit, LIMITS.resetIp.windowMs)
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const { token, user } = await authService.requestPasswordReset(input.email, {
    ip: context.ip,
    requestId: context.requestId,
  })

  if (token && user) {
    const sent = await sendPasswordResetMail({
      to: user.email,
      displayName: user.display_name,
      resetUrl: buildResetUrl(token),
      expiresInMinutes: 60,
    })
    if (!sent) {
      // Not an API error: the operator gets a hint in the log, the caller learns
      // nothing. Handing out the token here would defeat the whole flow.
      log('warn', 'reset requested but mail is not configured', { requestId: context.requestId })
    }
  }

  return ok({ accepted: true }, { status: 202, message: '如果该邮箱存在，重置邮件已经发送' })
})
