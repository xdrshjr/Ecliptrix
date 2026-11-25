import { ok, readJson, withContext } from '@/server/http/route'
import { requireAdminWrite } from '@/server/auth/guards'
import { errors } from '@/server/http/errors'
import { releaseActionSchema } from '@/server/validation/schemas'
import * as releaseService from '@/server/services/releaseService'
import { DEFAULT_RELEASE_CHANNEL } from '@/lib/releases'

/**
 * `PATCH /api/v1/admin/releases/{id}` — move the pointer, or edit the notes.
 *
 * One route, four deliberate actions, because they are four different promises to
 * the operator and the audit log has to say which one happened:
 *
 *  - `publish`  — this build becomes current for its platform (a draft is marked
 *                 published first, in the same transaction);
 *  - `rollback` — the pointer goes back to an OLDER build that is still published;
 *                 nothing is deleted, so the build we came from stays releasable;
 *  - `retract`  — this build is withdrawn and every pointer aimed at it is cleared
 *                 in the same transaction, so `/download` can never point at a
 *                 retracted artifact;
 *  - `notes`    — release notes only.
 */
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params
  return withContext(async ({ request: incoming, context }) => {
    const auth = requireAdminWrite(incoming, context, 'releases.write')
    const input = await readJson(incoming, releaseActionSchema)
    const channel = input.channel ?? DEFAULT_RELEASE_CHANNEL

    if (input.action === 'publish') {
      return ok({ release: releaseService.publishRelease(id, auth.audit, channel) })
    }
    if (input.action === 'rollback') {
      return ok({ release: releaseService.rollbackRelease(id, auth.audit, channel) })
    }
    if (input.action === 'retract') {
      return ok({ release: releaseService.retractRelease(id, auth.audit) })
    }
    if (input.action === 'notes') {
      return ok({ release: releaseService.updateReleaseNotes(id, input.notes ?? '', auth.audit) })
    }
    throw errors.notFound('未知的操作')
  })(request)
}
