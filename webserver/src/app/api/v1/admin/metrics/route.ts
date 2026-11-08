import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import * as metricsService from '@/server/services/metricsService'

/** `GET /api/v1/admin/metrics` — console overview aggregates. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  // Spec §4.2 gates the overview on `users.read`: it is the same audience that
  // can already enumerate every row the aggregate is computed from.
  requireAdminRead(request, context, 'users.read')
  return ok(metricsService.overview())
})
