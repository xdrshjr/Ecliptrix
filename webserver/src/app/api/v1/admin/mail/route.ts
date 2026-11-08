import { withContext, ok, readSearch } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import { parsePage, buildPageMeta } from '@/server/http/pagination'
import { maskEmail } from '@/server/services/privacy'
import { adminMailQuerySchema } from '@/server/validation/schemas'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'

/**
 * `GET /api/v1/admin/mail` — the outbox.
 *
 * The question this answers is the first one an operator asks: "did that mail go
 * out?". Recipients are masked, and the body of a row is only served by the detail
 * endpoint, because a list that carries every body is a list that carries every
 * (redacted) reset link.
 *
 * Read permission is `settings.read`: mail configuration and mail observability are
 * the same concern. `support` does not hold it, `admin` and `owner` do.
 *
 * The filter is validated rather than coerced: `?status=sentt` is a `422`, not
 * "every row", and `?template=` is length-bounded before it reaches the repository.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context, searchParams }) => {
  requireAdminRead(request, context, 'settings.read')

  const query = readSearch(searchParams, adminMailQuerySchema)
  const page = parsePage(searchParams)
  const result = outboxRepo.list(
    (await import('@/server/db/client')).getDb(),
    { status: query.status, template: query.template },
    page,
  )

  return ok({
    rows: result.rows.map((row) => ({
      id: row.id,
      template: row.template,
      toMasked: maskEmail(row.to_email),
      status: row.status,
      attempts: row.attempts,
      retryable: row.retryable === 1,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    })),
    total: result.total,
    page: buildPageMeta(result.total, page),
  })
})
