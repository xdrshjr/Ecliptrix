import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import * as settingsService from '@/server/services/settingsService'
import { SettingsForm } from '@/components/console/settings-form'

/** System settings — the values that change behaviour without a redeploy. */
export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'settings.read')) redirect('/admin/forbidden')

  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.settings.title')}</h1>
      </header>
      <SettingsForm
        locale={locale}
        settings={settingsService.all() as Record<string, boolean | number | string>}
        canWrite={can(session, 'settings.write')}
      />
    </div>
  )
}
