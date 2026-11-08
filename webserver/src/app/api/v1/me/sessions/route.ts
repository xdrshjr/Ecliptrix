import { withContext, ok } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import * as sessionService from '@/server/services/sessionService'
import { toSessionDto } from '@/server/db/types'

/** `GET /api/v1/me/sessions` — my devices, with the current one flagged. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })
  const rows = sessionService.listForUser(auth.user.id)
  return ok({
    items: rows.map((row) => toSessionDto(row, auth.session.id)),
    total: rows.length,
  })
})
