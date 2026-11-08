import { withContext, ok, readOptionalJson } from '@/server/http/route'
import { refreshSchema } from '@/server/validation/schemas'
import { setSessionCookies } from '@/server/http/cookies'
import { assertCsrf, readCookieFrom } from '@/server/http/requestContext'
import { REFRESH_COOKIE, ERROR_CODE } from '@/server/auth/constants'
import { newCsrfToken } from '@/server/auth/tokens'
import { AppError, errors } from '@/server/http/errors'
import * as sessionService from '@/server/services/sessionService'

/**
 * `POST /api/v1/auth/refresh`
 *
 * Rotation with reuse detection (spec §2.9 item 4): the presented token is
 * replaced, and presenting a *retired* token revokes every session of that user.
 *
 * Two carriers, and the carrier — not the `Authorization` header — decides the
 * response shape (spec §2.9.5):
 *  - the browser presents the token in the `ecs_refresh` cookie and gets new
 *    cookies back; that request is a cookie session, so it needs `X-CSRF-Token`;
 *  - the desktop posts `{ refreshToken }` in the body with **no** `Authorization`
 *    header at all (its access token has just expired, that is why it is here)
 *    and gets the new pair in the response body. Keying the mode off the header
 *    made every desktop refresh fail CSRF — the 90-day desktop refresh token
 *    never worked, so a user had to retype a password every 12 hours.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const body = await readOptionalJson(request, refreshSchema)
  const cookieToken = readCookieFrom(request.headers, REFRESH_COOKIE)
  const cookieMode = !body.refreshToken && Boolean(cookieToken)
  if (cookieMode) assertCsrf(context)

  const presented = body.refreshToken ?? cookieToken
  if (!presented) throw errors.unauthorized('缺少刷新令牌')

  const result = sessionService.rotateRefreshToken(presented, {
    ip: context.ip,
    userAgent: context.userAgent,
  })

  if (result === 'reuse-detected') {
    throw errors.unauthorized('检测到令牌重复使用，所有会话已被注销，请重新登录')
  }
  if (!result) {
    // `null` covers both "unknown/expired" and "revoked". When the row still
    // exists and is revoked, report why in `details.reason` so the desktop can
    // show "account deleted" instead of "please sign in again" (D3-08).
    const revokedReason = sessionService.revokeReasonForRefreshToken(presented)
    if (revokedReason) {
      throw new AppError(ERROR_CODE.sessionRevoked, '会话已失效，请重新登录', {
        details: { reason: revokedReason },
      })
    }
    throw errors.unauthorized('刷新令牌无效或已过期')
  }

  if (!cookieMode) {
    return ok({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: new Date(result.accessExpiresAt).toISOString(),
      refreshExpiresAt: new Date(result.refreshExpiresAt).toISOString(),
    })
  }

  const response = ok({ expiresAt: new Date(result.accessExpiresAt).toISOString() })
  setSessionCookies(response, {
    sessionToken: result.accessToken,
    refreshToken: result.refreshToken,
    csrfToken: newCsrfToken(),
  })
  return response
})
