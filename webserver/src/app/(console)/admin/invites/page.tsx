import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { listInvites } from '@/server/services/inviteService'
import { listRoles } from '@/server/services/roleService'
import { InvitesPanel } from '@/components/console/invites-panel'

/** Invite codes: the only way to gate registration to known people. */
export const dynamic = 'force-dynamic'

export default async function AdminInvitesPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'invites.read')) redirect('/admin/forbidden')

  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.invites.title')}</h1>
      </header>
      <InvitesPanel
        locale={locale}
        invites={listInvites()}
        roles={listRoles()
          .filter((role) => role.key !== 'owner')
          .map((role) => ({ key: role.key, name: role.name }))}
        canWrite={can(session, 'invites.write')}
      />
    </div>
  )
}
