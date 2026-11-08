import { NextResponse } from 'next/server'
import { withContext } from '@/server/http/route'
import { requireSession } from '@/server/auth/guards'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import * as accountExportService from '@/server/services/accountExportService'

/**
 * `GET /api/v1/me/export` — my data, as a JSON download.
 *
 * **This is the one endpoint family that does not use `ok()`.** `ok()` wraps the
 * payload in the shared envelope and always answers `application/json`, which
 * would turn a download into "a JSON file containing our envelope" and leave no
 * place to put `Content-Disposition`. The body is built with `new NextResponse`
 * instead, with the headers set explicitly.
 *
 * `x-request-id` is still added — `withContext` does that for every response it
 * returns, attachments included, so a failed download is traceable like any other
 * call.
 *
 * Errors (cooldown, no session) keep going through `throw`, so they are answered by
 * `fail()` as a JSON envelope: only a SUCCESS is an attachment. The integration
 * test asserts exactly that for the `429`.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ request, context }) => {
  const auth = requireSession(request, context, { allowPasswordChangeRequired: true })

  const limit = hit(
    'account:export',
    auth.user.id,
    LIMITS.accountExport.limit,
    LIMITS.accountExport.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const result = accountExportService.exportFor(auth.user, auth.audit)

  const response = new NextResponse(result.body, { status: 200 })
  response.headers.set('Content-Type', 'application/json; charset=utf-8')
  response.headers.set('Content-Disposition', `attachment; filename="${result.fileName}"`)
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
})
