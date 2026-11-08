import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import * as profileService from '@/server/services/profileService'
import * as settingsService from '@/server/services/settingsService'
import * as mailService from '@/server/services/mailService'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import { getDb } from '@/server/db/client'
import { ProfileForm } from '@/components/account/profile-form'
import { EmailPanel } from '@/components/account/email-panel'
import { DataExportPanel } from '@/components/account/data-export-panel'
import { DangerZone } from '@/components/account/danger-zone'

/**
 * Account centre — profile.
 *
 * Server component reading `profileService` directly (R1 layering: a page never
 * fetches its own API). It passes serialisable values only — `locale` is a string,
 * never a translation function, because a function prop throws at render time
 * inside a client component and 500s the page.
 *
 * Everything the client needs about the lifecycle (verification badge, pending
 * address, live deletion request, export cooldown) is resolved here, so the panels
 * can be pure presentation and the desktop can build the same view from `/me`.
 */
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  const locale = await resolveLocale()
  const tt = translator(locale)

  const profile = profileService.profile(session.user.id)
  const role = rolesRepo.findById(getDb(), session.user.role_id)
  const graceHours = settingsService.getNumber('account.deletionGraceHours')
  const cooldownWindow = settingsService.getNumber('account.exportCooldownMinutes')
  const lastExport = session.user.last_exported_at ?? null
  const remainingMinutes = lastExport
    ? Math.max(0, Math.ceil((lastExport + cooldownWindow * 60_000 - Date.now()) / 60_000))
    : 0

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('account.profile')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{session.user.email}</p>
      </header>
      <ProfileForm
        locale={locale}
        initial={{
          displayName: session.user.display_name,
          avatarUrl: session.user.avatar_url ?? '',
          locale: session.user.locale,
          timezone: session.user.timezone,
        }}
        email={session.user.email}
        username={session.user.username}
        roleName={role?.name ?? session.role.name}
        planTag={session.user.plan_tag}
      />
      <EmailPanel
        locale={locale}
        profile={profile}
        mailEnabled={mailService.isMailEnabled()}
      />
      <DataExportPanel locale={locale} cooldownMinutes={remainingMinutes} />
      <DangerZone
        locale={locale}
        profile={profile}
        graceHours={graceHours}
        mailEnabled={mailService.isMailEnabled()}
      />
    </div>
  )
}
