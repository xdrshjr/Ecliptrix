import { withContext, ok, readSearch } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import { parsePage, buildPageMeta, parseSort } from '@/server/http/pagination'
import { SESSION_SORT_COLUMNS } from '@/server/db/repositories/sessionsRepo'
import { adminSessionsQuerySchema } from '@/server/validation/schemas'
import * as adminSessionService from '@/server/services/adminSessionService'

/**
 * `GET /api/v1/admin/sessions` — every device of every account.
 *
 * `users.read` is the page permission (the same one that opens the user list), and
 * `support` holds it. Addresses and IPs are masked in the response: the console is
 * not meant to be a bulk personal-data export, and the full values remain
 * available per user on `/admin/users/{id}` where the context is one named account.
 *
 * The filter is schema-validated, so an unknown `client=` is a `422` rather than a
 * silently ignored parameter that makes the table look empty for no stated reason.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context, searchParams }) => {
  requireAdminRead(request, context, 'users.read')

  const query = readSearch(searchParams, adminSessionsQuerySchema)
  const page = parsePage(searchParams)
  const sort = parseSort(searchParams.get('sort'), SESSION_SORT_COLUMNS, '-last_seen_at')

  const result = adminSessionService.listAll({
    query: query.query,
    client: query.client,
    platform: query.platform,
    activeOnly: query.activeOnly === '1',
    sort,
    page,
  })

  return ok({
    rows: result.rows,
    total: result.total,
    page: buildPageMeta(result.total, page),
  })
})
