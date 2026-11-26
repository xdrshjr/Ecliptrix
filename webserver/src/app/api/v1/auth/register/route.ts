import { withContext, ok, readJson } from '@/server/http/route'
import { registerSchema } from '@/server/validation/schemas'
import { setSessionCookies } from '@/server/http/cookies'
import { errors } from '@/server/http/errors'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { newCsrfToken } from '@/server/auth/tokens'
import * as authService from '@/server/services/authService'

/** `POST /api/v1/auth/register` — self-service sign-up, gated by settings. */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const input = await readJson(request, registerSchema)

  const limit = hit('register:ip', context.ip, LIMITS.registerIp.limit, LIMITS.registerIp.windowMs)
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const result = await authService.register({
    email: input.email,
    password: input.password,
    username: input.username,
    displayName: input.displayName,
    inviteCode: input.inviteCode,
    client: input.client,
    clientVersion: input.clientVersion,
    device: input.device,
    ip: context.ip,
    userAgent: context.userAgent,
    requestId: context.requestId,
    captchaId: input.captchaId,
    captchaAnswer: input.captchaAnswer,
  })

  // One user shape for both carriers. The desktop session file needs the same
  // fields login returns (`planTag`, `avatarUrl`, `mustChangePassword`), and the
  // browser ignores the extras — two shapes is how `refreshExpiresAt` went
  // missing here while login had it (the gate then stored a session whose
  // offline grace was unbounded by the refresh token's own lifetime).
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
    // Same key set as login's user (tests/integration/desktop-login.test.ts
    // asserts the two payloads stay identical): a sign-up *is* a login.
    lastLoginAt: new Date().toISOString(),
  }

  const payload = {
    user,
    expiresAt: new Date(result.tokens.accessExpiresAt).toISOString(),
  }

  if (input.client === 'desktop') {
    return ok(
      {
        ...payload,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        refreshExpiresAt: new Date(result.tokens.refreshExpiresAt).toISOString(),
        sessionId: result.sessionId,
      },
      { status: 201 },
    )
  }

  const response = ok(payload, { status: 201 })
  setSessionCookies(response, {
    sessionToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    csrfToken: newCsrfToken(),
  })
  return response
})
