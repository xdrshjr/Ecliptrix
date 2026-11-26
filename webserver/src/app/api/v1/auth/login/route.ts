import { withContext, ok, readJson } from '@/server/http/route'
import { loginSchema } from '@/server/validation/schemas'
import { setSessionCookies } from '@/server/http/cookies'
import { assertCsrf, readCookieFrom } from '@/server/http/requestContext'
import { errors } from '@/server/http/errors'
import { SESSION_COOKIE } from '@/server/auth/constants'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { newCsrfToken } from '@/server/auth/tokens'
import * as authService from '@/server/services/authService'
import { normalizeEmail } from '@/server/services/normalize'

/**
 * `POST /api/v1/auth/login`
 *
 * One endpoint, two clients (spec §4.5):
 *  - `client=web` sets the three cookies and returns no tokens in the body;
 *  - `client=desktop` returns the token pair and sets no cookies.
 *
 * Rate limiting runs before any password work, so a brute-force run cannot use
 * this endpoint as a CPU amplifier.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const input = await readJson(request, loginSchema)

  // A login that arrives *with* a session cookie is a session-fixation vector:
  // an attacker's page can log the victim's browser into an account the attacker
  // controls, and everything the victim then does lands in that account. Spec
  // §2.5/§2.9.5 keys the requirement to the session cookie, not to the CSRF
  // cookie: if only `ecs_csrf` is checked, deleting that one cookie silently
  // turns the protection off.
  if (readCookieFrom(request.headers, SESSION_COOKIE)) assertCsrf(context)

  const ipLimit = hit('login:ip', context.ip, LIMITS.loginIp.limit, LIMITS.loginIp.windowMs)
  if (!ipLimit.allowed) throw errors.rateLimited(ipLimit.retryAfterSeconds)

  const identifierLimit = hit(
    'login:identifier',
    normalizeEmail(input.identifier),
    LIMITS.loginIdentifier.limit,
    LIMITS.loginIdentifier.windowMs,
  )
  if (!identifierLimit.allowed) throw errors.rateLimited(identifierLimit.retryAfterSeconds)

  const result = await authService.login({
    identifier: input.identifier,
    password: input.password,
    client: input.client,
    clientVersion: input.clientVersion,
    device: input.device,
    ip: context.ip,
    userAgent: context.userAgent,
    requestId: context.requestId,
    captchaId: input.captchaId,
    captchaAnswer: input.captchaAnswer,
  })

  const user = {
    id: result.user.id,
    email: result.user.email,
    username: result.user.username,
    displayName: result.user.display_name,
    avatarUrl: result.user.avatar_url,
    status: result.user.status,
    planTag: result.user.plan_tag,
    mustChangePassword: result.user.must_change_password === 1,
    // Needed by the desktop account centre and the unverified banner; register and
    // login answer the same key set on purpose (tests assert the parity).
    emailVerified: result.user.email_verified_at !== null,
    role: result.role,
    permissions: result.permissions,
    lastLoginAt: new Date().toISOString(),
  }

  if (input.client === 'desktop') {
    return ok({
      user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: new Date(result.tokens.accessExpiresAt).toISOString(),
      refreshExpiresAt: new Date(result.tokens.refreshExpiresAt).toISOString(),
      sessionId: result.sessionId,
    })
  }

  const response = ok({
    user,
    expiresAt: new Date(result.tokens.accessExpiresAt).toISOString(),
    sessionId: result.sessionId,
  })
  setSessionCookies(response, {
    sessionToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    csrfToken: newCsrfToken(),
  })
  return response
})
