import { withContext, ok, readJson } from '@/server/http/route'
import { emailVerifySchema } from '@/server/validation/schemas'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import { optionalSession } from '@/server/auth/guards'
import * as emailVerificationService from '@/server/services/emailVerificationService'

/**
 * `POST /api/v1/auth/email/verify` — consume a mailed token.
 *
 * Session-less by design: the person clicking the link may be on a phone with no
 * account session on that device. The token IS the credential, and the POST (not
 * a GET that mutates) is what keeps a mail scanner's pre-fetch from burning it.
 *
 * One error for unknown / expired / already-used / wrong-purpose
 * (`400 token_invalid`), so the endpoint cannot be used to probe tokens.
 *
 * The session is *optional* and only used for one thing: an address change
 * revokes every other session, and the browser that clicked the link is usually
 * signed in — revoking its own session would sign the user out of the page they
 * are looking at.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request, context }) => {
  const limit = hit(
    'email:verify',
    context.ip,
    LIMITS.emailVerifyConsume.limit,
    LIMITS.emailVerifyConsume.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const input = await readJson(request, emailVerifySchema)
  const current = optionalSession(request, context)
  const result = await emailVerificationService.consumeVerificationToken(input.token, {
    ip: context.ip,
    requestId: context.requestId,
    currentSessionId: current?.session.id,
  })
  return ok(result)
})
