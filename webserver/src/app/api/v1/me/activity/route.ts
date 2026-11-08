import { withContext, ok } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import { parsePage, buildPageMeta } from '@/server/http/pagination'
import * as profileService from '@/server/services/profileService'

/**
 * `GET /api/v1/me/activity` — my last 90 days, whitelisted actions only.
 *
 * `ipMasked` rather than `ip`: this endpoint feeds the web timeline AND the
 * desktop account centre, and an IP is personal data that has no business being
 * handed to a renderer that may log it. A user who genuinely needs the real value
 * asks an administrator, who sees it on the audit page.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context, searchParams }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  const page = parsePage(searchParams)
  const result = profileService.myActivity(auth.user.id, page)
  return ok({
    items: result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      ip: row.ip,
      ipMasked: row.ipMasked,
      createdAt: row.createdAt,
    })),
    page: buildPageMeta(result.total, page),
  })
})
