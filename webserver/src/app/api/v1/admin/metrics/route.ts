import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import * as metricsService from '@/server/services/metricsService'

/**
 * `GET /api/v1/admin/metrics?days=14|30` — console overview aggregates.
 *
 * `days` is bounded to 7–90 (spec §3.9). Out of range is a `422`, not a silent
 * clamp: an operator who typed `days=365` should learn that the chart will not show
 * a year, rather than quietly reading a 90-day window as if it were one.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context, searchParams }) => {
  // Spec §4.2 gates the overview on `users.read`: it is the same audience that
  // can already enumerate every row the aggregate is computed from.
  requireAdminRead(request, context, 'users.read')

  const raw = searchParams.get('days')
  let days = 14
  if (raw !== null && raw !== '') {
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 7 || parsed > 90) {
      throw new AppError(ERROR_CODE.validationFailed, 'days 必须在 7 到 90 之间', {
        details: { fields: [{ path: 'days', message: '取值范围 7–90' }] },
      })
    }
    days = parsed
  }

  return ok(metricsService.overview(Date.now(), days))
})
