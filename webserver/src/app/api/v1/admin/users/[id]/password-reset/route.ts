import { withContext, ok, readOptionalJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { passwordResetModeSchema } from '@/server/validation/schemas'
import { AppError, errors } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import * as userService from '@/server/services/userService'
import * as authService from '@/server/services/authService'
import * as mailService from '@/server/services/mailService'
import { buildResetUrl } from '@/server/mail/links'
import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import { translator } from '@/lib/i18n'
import { localeFromRequest } from '@/lib/locale'

/**
 * `POST /api/v1/admin/users/{id}/password-reset`
 *
 * Two modes. `temp_password` (default) works with no mail setup at all and
 * returns the password exactly once; `reset_link` mails a one-time token and
 * requires SMTP.
 *
 * The `reset_link` branch answers `503 mail_disabled` when mail is not
 * configured — here an explicit error beats a silent no-op, because the
 * administrator explicitly asked for delivery (spec §1.3, the one sanctioned
 * exception to "mail never changes an API result"). It also checks the send
 * result: before the outbox existed the `false` return of the old mailer was
 * ignored, so the console reported "sent" for a message that never left.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')

    const input = await readOptionalJson(request, passwordResetModeSchema)

    if (input.mode === 'temp_password') {
      const result = await userService.resetUserPassword(id, auth.audit)
      return ok({
        mode: 'temp_password',
        temporaryPassword: result.temporaryPassword,
        expiresAt: result.expiresAt,
        mustChangePassword: true,
      })
    }

    if (!mailService.isMailEnabled()) throw errors.mailDisabled()

    const user = usersRepo.findById(getDb(), id)
    if (!user) throw errors.notFound('用户不存在')

    const { token } = await authService.requestPasswordReset(user.email, {
      ip: context.ip,
      requestId: context.requestId,
    })
    if (!token) throw new AppError(ERROR_CODE.conflict, '该账号当前不可重置口令')

    const locale = localeFromRequest(request)
    const tt = translator(locale)
    const queued = await mailService.queue({
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

    if (queued.status === 'failed') {
      throw new AppError(ERROR_CODE.serviceUnavailable, '重置邮件发送失败，可稍后在邮件队列中重试', {
        details: { hint: '请检查 SMTP 配置，或改用 mode=temp_password', outboxId: queued.id },
      })
    }

    return ok({ mode: 'reset_link', sentTo: user.email, mailStatus: queued.status })
  })(request)
}
