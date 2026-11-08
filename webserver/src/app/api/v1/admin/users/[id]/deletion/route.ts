import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { adminDeletionConfirmSchema } from '@/server/validation/schemas'
import * as accountDeletionService from '@/server/services/accountDeletionService'

/**
 * `POST /api/v1/admin/users/{id}/deletion` — confirm a pending deletion on behalf.
 *
 * Why this exists: a user who lost access to the mailbox would otherwise never be
 * able to close their account (the confirmation link is unreachable), and "you
 * cannot leave" is not defensible for a feature that exists for compliance reasons.
 * The offline twin is `npm run account:confirm-deletion`.
 *
 * It does NOT skip the grace period and it does NOT skip the audit: only the
 * "click the link" step is replaced, by an operator decision with a stated reason.
 * Permission is `users.delete` — deleting an account is the strongest user-mutating
 * action there is.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ context }) => {
    const auth = requireAdminWrite(request, context, 'users.delete')
    const input = await readJson(request, adminDeletionConfirmSchema)
    const result = accountDeletionService.confirmByAdmin(id, input.reason, auth.audit)
    return ok(result)
  })(request)
}
