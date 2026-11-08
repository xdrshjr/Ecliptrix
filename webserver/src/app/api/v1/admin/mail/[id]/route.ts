import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { maskEmail } from '@/server/services/privacy'
import { errors } from '@/server/http/errors'

/**
 * `GET /api/v1/admin/mail/{id}` — one queued mail, text only.
 *
 * `html` is deliberately NOT returned: the console would become a renderer for
 * content an attacker can influence through a display name, and the plain text is
 * what an operator actually reads. The stored body already has `token=***`.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    requireAdminRead(request, context, 'settings.read')
    const row = outboxRepo.findById(getDb(), id)
    if (!row) throw errors.notFound('邮件不存在')
    return ok({
      id: row.id,
      template: row.template,
      toMasked: maskEmail(row.to_email),
      subject: row.subject,
      text: row.body_text,
      status: row.status,
      attempts: row.attempts,
      retryable: row.retryable === 1,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    })
  })(request)
}
