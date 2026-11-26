import { withContext, ok } from '@/server/http/route'
import { requireAdminRead } from '@/server/auth/guards'
import * as securityPostureService from '@/server/services/securityPostureService'

/**
 * `GET /api/v1/admin/security` — the security posture panel's data.
 *
 * `security.read` is deliberately held by `admin` only: the response includes the
 * root administrator's account state and the escalation attempts made against it,
 * which a read-only support role has no business seeing (review R-16). `owner`
 * reaches it through `'*'`.
 *
 * `window` exists so a test (and an incident responder) can widen the look-back
 * without waiting a day; it is bounded to a sane range rather than accepted raw.
 */
export const dynamic = 'force-dynamic'

const MIN_WINDOW_HOURS = 1
const MAX_WINDOW_HOURS = 24 * 30

export const GET = withContext(async ({ request, context, searchParams }) => {
  requireAdminRead(request, context, 'security.read')

  const raw = searchParams.get('window')
  const parsed = raw === null || raw === '' ? 24 : Number(raw)
  const windowHours =
    Number.isFinite(parsed) && parsed >= MIN_WINDOW_HOURS && parsed <= MAX_WINDOW_HOURS
      ? Math.round(parsed)
      : 24

  return ok(securityPostureService.posture(windowHours))
})
