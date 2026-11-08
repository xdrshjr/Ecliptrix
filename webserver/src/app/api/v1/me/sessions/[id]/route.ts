import { withContext, ok } from '@/server/http/route'
import { clearSessionCookies } from '@/server/http/cookies'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import { errors } from '@/server/http/errors'
import * as profileService from '@/server/services/profileService'

/**
 * `DELETE /api/v1/me/sessions/{id}` — revoke one of my own devices.
 *
 * Someone else's session id answers `not_found`: a `403` would confirm that the
 * id exists, which is precisely the enumeration signal `/me/*` must not give.
 *
 * Revoking the session you are calling from is a logout (spec §4.2), so the
 * cookies go with it. Leaving them behind left the browser holding a dead
 * `ecs_session` that middleware kept waving through `/account` until the next
 * request failed.
 */
export const dynamic = 'force-dynamic'

export const DELETE = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop()
  if (!id) throw errors.notFound('会话不存在')

  profileService.revokeMySession(auth.user.id, id, auth.session.id, auth.audit)

  const response = ok({ revoked: true, sessionId: id })
  if (id === auth.session.id && !isBearerRequest(request)) clearSessionCookies(response)
  return response
})
