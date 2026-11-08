import { notFound, redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { list as listAudit } from '@/server/db/repositories/auditRepo'
import { toSessionDto } from '@/server/db/types'
import { toAdminUserDto } from '@/server/http/dto'
import { listRoles, permissionsOf } from '@/server/services/roleService'
import { getUserDetail } from '@/server/services/userService'
import { listForUser } from '@/server/services/sessionService'
import { AppError } from '@/server/http/errors'
import { UserDetail } from '@/components/console/user-detail'
import type { AdminUserDto, RoleOption, SessionDto } from '@/lib/api/endpoints'

/**
 * User detail.
 *
 * Four tabs over data that already exists in three other endpoints; assembling
 * it here in one query pass avoids the client waterfall a tab-per-request design
 * would create on a page an administrator opens during an incident.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) redirect('/admin/forbidden')

  const { id } = await params
  const locale = await resolveLocale()

  const detail = loadUser(id)
  if (!detail) notFound()

  const sessions: SessionDto[] = listForUser(id).map((row) => toSessionDto(row))
  const roles: RoleOption[] = listRoles().map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
  }))

  const { rows: auditRows } = listAudit(
    getDb(),
    { targetType: 'user', targetId: id },
    { page: 1, pageSize: 50, offset: 0 },
  )

  return (
    <UserDetail
      locale={locale}
      user={toAdminUserDto(detail) as unknown as AdminUserDto}
      sessions={sessions}
      activity={auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        ip: row.ip,
        createdAt: new Date(row.created_at).toISOString(),
      }))}
      roles={roles}
      permissions={safePermissions(detail.role_id)}
      canWrite={can(session, 'users.write')}
      canDelete={can(session, 'users.delete')}
      canRevokeSessions={can(session, 'sessions.revoke')}
      isSelf={session.user.id === id}
      isOwnerTarget={detail.role_key === 'owner'}
    />
  )
}

/** `null` when the id does not exist, so the page can answer 404 instead of 500. */
function loadUser(id: string) {
  try {
    return getUserDetail(id)
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null
    throw error
  }
}

/** A role deleted while a user still references it yields an empty set, not a crash. */
function safePermissions(roleId: string): string[] {
  try {
    return permissionsOf(roleId)
  } catch (error) {
    if (error instanceof AppError) return []
    throw error
  }
}
