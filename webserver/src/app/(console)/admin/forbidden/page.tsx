import { resolveLocale } from '@/lib/locale'
import { ForbiddenNotice } from '@/components/console/forbidden-notice'

/** 403 page shown instead of a 404, so a member knows to ask for access. */
export default async function ForbiddenPage() {
  const locale = await resolveLocale()
  return <ForbiddenNotice locale={locale} />
}
