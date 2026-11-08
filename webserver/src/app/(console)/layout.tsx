import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { ConsoleShell, type ConsoleNavItem } from '@/components/console/console-shell'

/**
 * Console shell for both `/account` and `/admin`.
 *
 * Server-side authorisation: no session → `/login` with a `next` hint. This is the
 * authoritative check; middleware only saves a render when the cookie is absent.
 *
 * The whole navigation — admin section included — is built and filtered HERE,
 * against the session's real permissions. The shell used to re-derive the admin
 * links from a single `users.read` flag, so a support role (users.read +
 * sessions.revoke + audit.read, no roles/invites/settings) was shown three links
 * that each resolved to the 403 page. Every item now carries the permission it
 * needs, and an item the caller cannot use is never sent to the client at all.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession()
  if (!session) redirect('/login?reason=session-expired')

  const locale = await resolveLocale()
  const tt = translator(locale)

  const items: (ConsoleNavItem & { permission: string | null })[] = [
    { href: '/account', label: tt('account.profile'), section: 'account', permission: null },
    { href: '/account/security', label: tt('account.security'), section: 'account', permission: null },
    { href: '/account/activity', label: tt('account.activity'), section: 'account', permission: null },
    { href: '/admin', label: tt('admin.title'), section: 'admin', permission: 'users.read' },
    { href: '/admin/users', label: tt('admin.users.title'), section: 'admin', permission: 'users.read' },
    {
      href: '/admin/sessions',
      label: tt('admin.sessions.title'),
      section: 'admin',
      permission: 'users.read',
    },
    { href: '/admin/roles', label: tt('admin.roles.title'), section: 'admin', permission: 'roles.read' },
    {
      href: '/admin/invites',
      label: tt('admin.invites.title'),
      section: 'admin',
      permission: 'invites.read',
    },
    { href: '/admin/audit', label: tt('admin.audit.title'), section: 'admin', permission: 'audit.read' },
    {
      href: '/admin/mail',
      label: tt('admin.mail.title'),
      section: 'admin',
      permission: 'settings.read',
    },
    { href: '/admin/settings', label: tt('admin.settings.title'), section: 'admin', permission: 'settings.read' },
  ]

  const nav: ConsoleNavItem[] = items
    .filter((item) => item.permission === null || can(session, item.permission))
    .map(({ href, label, section }) => ({ href, label, section }))

  return (
    <ConsoleShell
      locale={locale}
      nav={nav}
      user={{
        displayName: session.user.display_name,
        email: session.user.email,
        roleKey: session.role.key,
        roleName: session.role.name,
        mustChangePassword: session.user.must_change_password === 1,
      }}
    >
      {children}
    </ConsoleShell>
  )
}
