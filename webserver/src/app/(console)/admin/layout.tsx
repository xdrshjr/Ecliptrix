import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { ForbiddenNotice } from '@/components/console/forbidden-notice'

/**
 * Second-level guard for every `/admin/*` page.
 *
 * The console layout already refuses a visitor with no session; each page also
 * re-checks the permission it needs. This layer answers the case both miss: a
 * signed-in member who types `/admin/users` directly sees the 403 body at the
 * URL they asked for.
 *
 * It renders instead of redirecting on purpose. Redirecting to
 * `/admin/forbidden` would re-enter this very layout (the route lives under
 * `/admin`) and loop, which a browser reports as a blank page rather than an
 * error.
 *
 * A layout is not a security boundary in Next.js — nested routes can be reached
 * through a parallel-route boundary — so this stays a convenience layer and the
 * pages and API routes still authorise themselves.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) {
    const locale = await resolveLocale()
    return <ForbiddenNotice locale={locale} />
  }
  return <>{children}</>
}
