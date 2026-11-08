import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { listRoles, permissionCatalogue } from '@/server/services/roleService'
import { PermissionMatrix } from '@/components/console/permission-matrix'

/** Roles and the permission matrix. `owner` is rendered read-only. */
export const dynamic = 'force-dynamic'

export default async function AdminRolesPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'roles.read')) redirect('/admin/forbidden')

  const locale = await resolveLocale()
  const tt = translator(locale)

  const roles = listRoles().map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.is_system === 1,
    permissions: role.permissions,
    userCount: role.user_count,
  }))

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.roles.title')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{tt('permissions.subtitle')}</p>
      </header>
      <PermissionMatrix
        locale={locale}
        roles={roles}
        permissions={[...permissionCatalogue().all]}
        canWrite={can(session, 'roles.write')}
      />
    </div>
  )
}
