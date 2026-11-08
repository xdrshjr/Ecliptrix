import { withContext, ok } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'

/** `GET /api/v1/auth/session` — who am I, with permissions, for the first frame. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  return ok({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      username: auth.user.username,
      displayName: auth.user.display_name,
      avatarUrl: auth.user.avatar_url,
      status: auth.user.status,
      planTag: auth.user.plan_tag,
      mustChangePassword: auth.user.must_change_password === 1,
      locale: auth.user.locale,
      timezone: auth.user.timezone,
    },
    role: auth.role,
    permissions: auth.permissions,
    session: {
      id: auth.session.id,
      client: auth.session.client,
      expiresAt: new Date(auth.session.access_expires_at).toISOString(),
      createdAt: new Date(auth.session.created_at).toISOString(),
    },
  })
})
