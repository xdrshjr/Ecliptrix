import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { listRoles } from '@/server/services/roleService'
import { listUsers } from '@/server/services/userService'
import { parseSort } from '@/server/http/pagination'
import { USER_SORT_COLUMNS } from '@/server/db/repositories/usersRepo'
import { toAdminUserDto } from '@/server/http/dto'
import { UsersTable } from '@/components/console/users-table'
import type { UserStatus } from '@/server/db/types'

/**
 * User list.
 *
 * Filters live in the URL, so a reload, a bookmark or a colleague's link all show
 * the same rows — and the server does the paging, which is the only version that
 * survives 10k users.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

const STATUSES: UserStatus[] = ['active', 'suspended', 'pending', 'deleted']

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, Number(params.pageSize ?? '20') || 20))
  const sort = parseSort(params.sort ?? null, USER_SORT_COLUMNS, '-created_at')
  const status = STATUSES.find((value) => value === params.status)

  const result = listUsers({
    query: params.query,
    status,
    roleKey: params.role,
    plan: params.plan,
    sort,
    page: { page, pageSize, offset: (page - 1) * pageSize },
  })

  const roles = listRoles().map((role) => ({ id: role.id, key: role.key, name: role.name }))

  return (
    <div className="mx-auto max-w-6xl">
      <UsersTable
        locale={locale}
        rows={result.rows.map((row) => toAdminUserDto(row) as never)}
        total={result.total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        roles={roles}
        initialQuery={params.query ?? ''}
        initialStatus={status ?? ''}
        canWrite={can(session, 'users.write')}
        canDelete={can(session, 'users.delete')}
        canRevokeSessions={can(session, 'sessions.revoke')}
        currentUserId={session.user.id}
      />
    </div>
  )
}
