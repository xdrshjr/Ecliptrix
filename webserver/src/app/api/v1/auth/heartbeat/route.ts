import { withContext, ok } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import { HEARTBEAT_TOUCH_INTERVAL_MS } from '@/server/auth/constants'
import * as sessionService from '@/server/services/sessionService'

/**
 * `POST /api/v1/auth/heartbeat` — desktop liveness and revocation probe.
 *
 * The desktop calls this on start and every 15 minutes. A `401` here is the
 * signal to drop the cached session immediately; a network error is not (the
 * client keeps working inside its offline grace window).
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const limit = hit(
    'heartbeat:session',
    auth.session.id,
    LIMITS.heartbeatSession.limit,
    LIMITS.heartbeatSession.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const now = Date.now()
  // Touch at most every 5 minutes: a 15-minute heartbeat would otherwise write
  // four times more rows than the "last seen" precision needs.
  if (now - auth.session.last_seen_at > HEARTBEAT_TOUCH_INTERVAL_MS) {
    sessionService.touch(auth.session.id, now)
  }

  return ok({
    ok: true,
    sessionId: auth.session.id,
    userId: auth.user.id,
    expiresAt: new Date(auth.session.access_expires_at).toISOString(),
    revoked: false,
    mustChangePassword: auth.user.must_change_password === 1,
    role: auth.role,
    permissions: auth.permissions,
  })
})
