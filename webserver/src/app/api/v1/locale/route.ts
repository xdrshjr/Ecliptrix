import { withContext, ok, readJson } from '@/server/http/route'
import { localeCookieSchema, LOCALE_COOKIE_NAME } from '@/server/validation/schemas'
import { getConfig } from '@/server/config'

/**
 * `POST /api/v1/locale`
 *
 * The language switch writes a cookie and the caller refreshes the page. No
 * server action: keeping every mutation on the REST surface means the desktop
 * client and the web console exercise exactly the same code path.
 */
export const dynamic = 'force-dynamic'

export const POST = withContext(async ({ request }) => {
  const input = await readJson(request, localeCookieSchema)
  const response = ok({ locale: input })
  response.cookies.set({
    name: LOCALE_COOKIE_NAME,
    value: input,
    path: '/',
    sameSite: 'lax',
    secure: getConfig().isProduction,
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
})
