import { withContext, ok } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import * as mailService from '@/server/services/mailService'
import * as auditService from '@/server/services/auditService'

/**
 * `POST /api/v1/admin/mail/{id}/retry` — send it again, synchronously.
 *
 * This is the ONLY place the request waits for SMTP: the administrator clicked
 * "send now, tell me the result". Everywhere else the outbox takes over.
 *
 * Permission is `users.write`, not `settings.write`: `admin` does not hold
 * `settings.write` (only `owner` does), and "only the super-admin can retry a
 * mail" is the opposite of what an operations console is for. `users.write` is
 * exactly right — owner and admin have it, support does not.
 *
 * `409 conflict` for a row whose body carries `token=***`: a retry would deliver a
 * broken link, so the answer is "ask the user to request a new one".
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.write')

    const row = await mailService.retry(id)
    if (row.status === 'failed') {
      auditService.record(auth.audit, {
        action: 'mail.delivery_failed',
        targetType: 'mail',
        targetId: id,
        metadata: { outboxId: id, template: row.template },
      })
    }
    return ok({
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
    })
  })(request)
}
