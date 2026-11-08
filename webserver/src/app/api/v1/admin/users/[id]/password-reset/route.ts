import { withContext, ok, readOptionalJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { passwordResetModeSchema } from '@/server/validation/schemas'
import { AppError, errors } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import * as userService from '@/server/services/userService'
import * as authService from '@/server/services/authService'
import { buildResetUrl, isMailEnabled, sendPasswordResetMail } from '@/server/mail/mailer'
import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'

/**
 * `POST /api/v1/admin/users/{id}/password-reset`
 *
 * Two modes. `temp_password` (default) works with no mail setup at all and
 * returns the password exactly once; `reset_link` mails a one-time token and
 * requires SMTP, answering `service_unavailable` when it is not configured —
 * here an explicit error beats a silent no-op, because the administrator
 * explicitly asked for delivery.
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

    if (!isMailEnabled()) {
      throw new AppError(ERROR_CODE.serviceUnavailable, '未配置邮件服务，无法发送重置链接', {
        details: { hint: '请使用 mode=temp_password，或在 .env 中配置 SMTP' },
      })
    }

    const user = usersRepo.findById(getDb(), id)
    if (!user) throw errors.notFound('用户不存在')

    const { token } = await authService.requestPasswordReset(user.email, {
      ip: context.ip,
      requestId: context.requestId,
    })
    if (!token) throw new AppError(ERROR_CODE.conflict, '该账号当前不可重置口令')

    await sendPasswordResetMail({
      to: user.email,
      displayName: user.display_name,
      resetUrl: buildResetUrl(token),
      expiresInMinutes: 60,
    })
    return ok({ mode: 'reset_link', sentTo: user.email })
  })(request)
}
