import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { settingsPatchSchema } from '@/server/validation/schemas'
import * as settingsService from '@/server/services/settingsService'
import * as auditService from '@/server/services/auditService'

/** `/api/v1/admin/settings` — read all, or patch a whitelisted subset. */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  requireAdminRead(request, context, 'settings.read')
  return ok({
    settings: settingsService.all(),
    available: settingsService.SETTING_KEYS,
  })
})

export const PATCH = withContext(async ({ request, context }) => {
  const auth = requireAdminWrite(request, context, 'settings.write')
  const input = await readJson(request, settingsPatchSchema)

  const result = settingsService.patch(input, auth.user.id)
  auditService.record(auth.audit, {
    action: 'settings.update',
    targetType: 'settings',
    targetId: '',
    metadata: { changed: result.changed },
  })
  return ok({ settings: settingsService.all(), changed: result.changed })
})
