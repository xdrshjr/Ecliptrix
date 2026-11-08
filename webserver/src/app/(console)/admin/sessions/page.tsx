import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { parseSort } from '@/server/http/pagination'
import { SESSION_SORT_COLUMNS } from '@/server/db/repositories/sessionsRepo'
import * as adminSessionService from '@/server/services/adminSessionService'
import { SessionsTable } from '@/components/console/sessions-table'

/**
 * `/admin/sessions` — every device of every account.
 *
 * RSC reading the service directly (never fetching its own API). Filters and paging
 * come from `searchParams`, exactly like `/admin/users`, so a reload or a shared URL
 * shows the same rows and the server does the slicing.
 *
 * `sessions.revoke` (not `users.read`) decides whether the bulk action is offered:
 * `support` holds it, so the buttons appear for support too — that is the existing
 * role design, not an oversight.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function AdminSessionsPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, Number(params.pageSize ?? '20') || 20))
  const sort = parseSort(params.sort ?? null, SESSION_SORT_COLUMNS, '-last_seen_at')
  const client = params.client === 'web' || params.client === 'desktop' ? params.client : undefined

  const result = adminSessionService.listAll({
    query: params.query,
    client,
    platform: params.platform,
    activeOnly: params.activeOnly === '1',
    sort,
    page: { page, pageSize, offset: (page - 1) * pageSize },
  })

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">{tt('admin.sessions.title')}</h1>
      </header>
      <SessionsTable
        locale={locale}
        rows={result.rows}
        total={result.total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        filters={{
          query: params.query ?? '',
          client: client ?? '',
          platform: params.platform ?? '',
          activeOnly: params.activeOnly === '1',
        }}
        canRevoke={can(session, 'sessions.revoke')}
      />
    </div>
  )
}
