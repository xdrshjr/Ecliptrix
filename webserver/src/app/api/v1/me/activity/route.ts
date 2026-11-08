import { withContext, ok } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import { parsePage, buildPageMeta } from '@/server/http/pagination'
import * as profileService from '@/server/services/profileService'

/** `GET /api/v1/me/activity` — my last 90 days, whitelisted actions only. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context, searchParams }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  const page = parsePage(searchParams)
  const result = profileService.myActivity(auth.user.id, page)
  return ok({
    items: result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      ip: row.ip,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    page: buildPageMeta(result.total, page),
  })
})
