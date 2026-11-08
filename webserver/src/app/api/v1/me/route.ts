import { withContext, ok, readJson } from '@/server/http/route'
import { profilePatchSchema } from '@/server/validation/schemas'
import { requireSession, isBearerRequest } from '@/server/auth/guards'
import { assertCsrf } from '@/server/http/requestContext'
import * as profileService from '@/server/services/profileService'

/**
 * `/api/v1/me` — the caller's own profile.
 *
 * `PATCH` uses a `.strict()` schema: `email`, `status`, `roleId` and `planTag`
 * are administrator-owned, so sending one is a 422 rather than a silent no-op.
 * A client that believes it changed a role is worse than one that got an error.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  return ok(profileService.profile(auth.user.id))
})

export const PATCH = withContext(async ({ request, context }) => {
  if (!isBearerRequest(request)) assertCsrf(context)
  const auth = requireSession(request, context)
  const input = await readJson(request, profilePatchSchema)
  return ok(profileService.updateProfile(auth.user.id, input, auth.audit))
})
