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
    device: input.device,
    ip: context.ip,
    userAgent: context.userAgent,
    requestId: context.requestId,
  })

  const payload = {
    user: {
      id: result.user.id,
      email: result.user.email,
      username: result.user.username,
      displayName: result.user.display_name,
      status: result.user.status,
      role: result.role,
      permissions: result.permissions,
    },
    expiresAt: new Date(result.tokens.accessExpiresAt).toISOString(),
  }

  if (input.client === 'desktop') {
    return ok(
      {
        ...payload,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
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
