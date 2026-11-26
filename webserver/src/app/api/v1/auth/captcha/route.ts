import { withContext, ok, readSearch } from '@/server/http/route'
import { captchaQuerySchema } from '@/server/validation/schemas'
import * as captchaService from '@/server/services/captchaService'

/**
 * `GET /api/v1/auth/captcha?purpose=register|login` — issue a challenge.
 *
 * Public: a visitor who cannot get an image cannot register. Rate limited per
 * caller (`LIMITS.captchaIssue`), which is also the table-growth ceiling.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async ({ context, searchParams }) => {
  const { purpose } = readSearch(searchParams, captchaQuerySchema)
  const captcha = captchaService.issue(purpose, {
    ip: context.ip,
    userAgent: context.userAgent,
    requestId: context.requestId,
  })
  return ok({ captcha })
})
