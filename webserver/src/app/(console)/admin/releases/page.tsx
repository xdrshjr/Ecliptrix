import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import * as releaseService from '@/server/services/releaseService'
import { ReleasesPanel } from '@/components/console/releases-panel'

/**
 * `/admin/releases` — upload, publish, roll back and withdraw installers.
 *
 * Two guards, both copied from the sibling console pages rather than invented:
 * `force-dynamic` (every row and every "current version" is live data) and a
 * second `can()` check, because the `/admin` layout is a convenience layer, not a
 * security boundary in Next.js.
 */
export const dynamic = 'force-dynamic'

export default async function AdminReleasesPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'releases.read')) redirect('/admin/forbidden')

  const locale = await resolveLocale()
  const tt = translator(locale)
  const latest = releaseService.latestPublished()

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.releases.title')}</h1>
        <p className="mt-1 max-w-prose text-xs leading-5 text-[var(--muted)]">
          {tt('admin.releases.subtitle')}
        </p>
      </header>
      <ReleasesPanel
        locale={locale}
        releases={releaseService.adminList()}
        latest={latest}
        canWrite={can(session, 'releases.write')}
      />
    </div>
  )
}
