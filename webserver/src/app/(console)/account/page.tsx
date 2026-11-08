import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { ProfileForm } from '@/components/account/profile-form'
import { DangerZone } from '@/components/account/danger-zone'

/** Account centre — profile. Presentation fields only; email is admin-managed. */
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  const locale = await resolveLocale()
  const tt = translator(locale)

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
        roleName={session.role.name}
        planTag={session.user.plan_tag}
      />
      <DangerZone locale={locale} />
    </div>
  )
}
