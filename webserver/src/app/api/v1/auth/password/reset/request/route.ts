import { withContext, ok, readJson } from '@/server/http/route'
import { resetRequestSchema } from '@/server/validation/schemas'
import { errors } from '@/server/http/errors'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import * as mailService from '@/server/services/mailService'
import { buildResetUrl } from '@/server/mail/links'
import { translator } from '@/lib/i18n'
import { localeFromRequest } from '@/lib/locale'

/**
 * `POST /api/v1/auth/password/reset/request`
 *
 * Always answers `202` with an empty body, whether or not the address exists and
 * whether or not mail is configured. Anything else would turn this endpoint into
 * an account-enumeration oracle (spec §2.9 item 8).
 *
 * Since migration 0005 every mail goes through `mailService`, so a deployment
 * without SMTP still records the message in the outbox instead of losing it —
 * and the delivery attempt is fired without awaiting, because a 5 s SMTP stall
 * has no business lengthening a password-reset request.
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
    const locale = localeFromRequest(request)
    const tt = translator(locale)
    mailService.queueInBackground({
      template: 'password-reset',
      to: user.email,
      locale,
      userId: user.id,
      params: {
        displayName: user.display_name,
        link: buildResetUrl(token),
        expiresIn: tt('mail.duration.minutes', { count: 60 }),
      },
    })
  }

  return ok({ accepted: true }, { status: 202, message: '如果该邮箱存在，重置邮件已经发送' })
})
