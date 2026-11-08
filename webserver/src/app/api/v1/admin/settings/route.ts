import { withContext, ok, readJson } from '@/server/http/route'
import { requireAdminRead, requireAdminWrite } from '@/server/auth/guards'
import { settingsPatchSchema } from '@/server/validation/schemas'
import * as settingsService from '@/server/services/settingsService'
import * as mailService from '@/server/services/mailService'
import * as auditService from '@/server/services/auditService'

/**
 * `/api/v1/admin/settings` — read all, or patch a whitelisted subset.
 *
 * The read includes a `mail` block that is NOT a setting: mode (`smtp` or
 * `outbox`), the sender address and the last-24h counters. An administrator has to
 * be able to see "mail is not actually being sent" without reading the logs, and a
 * PATCH that carries `mail` is a `422` like any other unknown key.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  requireAdminRead(request, context, 'settings.read')
  return ok({
    settings: settingsService.all(),
    available: settingsService.SETTING_KEYS,
    mail: mailService.capabilities(),
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
  return ok({
    settings: settingsService.all(),
    changed: result.changed,
    mail: mailService.capabilities(),
  })
})
