import { withContext, ok } from '@/server/http/route'
import { clearSessionCookies } from '@/server/http/cookies'
import { assertCsrf, readCookieFrom } from '@/server/http/requestContext'
import { SESSION_COOKIE } from '@/server/auth/constants'
import { resolveAuth } from '@/server/auth/guards'
import * as authService from '@/server/services/authService'

/**
 * `POST /api/v1/auth/logout`
 *
 * Idempotent: logging out twice is a success, not a 401. The desktop client
 * calls this on quit and may not know whether its token had already expired.
 *
 * CSRF applies only when the request carries a session cookie — that is the
 * request shape an attacker's page can produce. A Bearer call, or a cookie-less
 * browser call (nothing to protect, nothing to fix), is answered normally so
 * "sign out" can never be the one button that returns 403.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  if (readCookieFrom(request.headers, SESSION_COOKIE)) assertCsrf(context)

  const auth = resolveAuth(request, context)
  if (auth) {
    authService.logout(auth.session.id, auth.user.id, context.requestId, context.ip)
  }

  const response = ok({ loggedOut: true })
  clearSessionCookies(response)
  return response
})
