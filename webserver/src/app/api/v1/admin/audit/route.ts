import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import { parsePage, buildPageMeta } from '@/server/http/pagination'
import { getDb } from '@/server/db/client'
import * as auditRepo from '@/server/db/repositories/auditRepo'

/**
 * `GET /api/v1/admin/audit`
 *
 * Filters: actor (id), action (exact or `prefix.*`), targetType, targetId,
 * from/to (ISO), query (free text over actor label, action and target id).
 */
export const dynamic = 'force-dynamic'

function parseDate(raw: string | null): number | undefined {
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const GET = withContext(async ({ request, context, searchParams }) => {
  requireAdminRead(request, context, 'audit.read')
  const page = parsePage(searchParams)
  const result = auditRepo.list(
    getDb(),
    {
      actorUserId: searchParams.get('actor') ?? undefined,
      action: searchParams.get('action') ?? undefined,
      targetType: searchParams.get('targetType') ?? undefined,
      targetId: searchParams.get('targetId') ?? undefined,
      query: searchParams.get('query') ?? undefined,
      from: parseDate(searchParams.get('from')),
      to: parseDate(searchParams.get('to')),
    },
    page,
  )

  return ok({
    items: result.rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorLabel: row.actor_label,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: safeParse(row.metadata),
      ip: row.ip,
      requestId: row.request_id,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    page: buildPageMeta(result.total, page),
  })
})

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Display-only field: a hand-edited row degrades to empty, never a 500.
    return {}
  }
}
