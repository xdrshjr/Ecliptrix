import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'
import { LOCALE_COOKIE } from '@/server/auth/constants'

/**
 * Locale resolution for server components: explicit cookie first, then the
 * `Accept-Language` header, then zh-CN. Same order as spec §8.1.
 */
export async function resolveLocale(): Promise<Locale> {
  const store = await cookies()
  const fromCookie = store.get(LOCALE_COOKIE)?.value
  if (isLocale(fromCookie)) return fromCookie

  const acceptLanguage = (await import('next/headers')).headers
  const headersList = await acceptLanguage()
  const header = headersList.get('accept-language') ?? ''
  if (/^en\b/i.test(header.trim())) return 'en-US'
  if (/^zh\b/i.test(header.trim())) return 'zh-CN'
  return DEFAULT_LOCALE
}
