import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { list as listAudit } from '@/server/db/repositories/auditRepo'
import { buildPageMeta, parsePage } from '@/server/http/pagination'
import { AuditTable } from '@/components/console/audit-table'

/** Audit log: every write, every login attempt, every authorisation denial. */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'audit.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)

  const urlSearch = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) urlSearch.set(key, value)
  }
  const page = parsePage(urlSearch)

  const result = listAudit(
    getDb(),
    {
      action: params.action,
      targetType: params.targetType,
      query: params.query,
      actorUserId: params.actor,
      from: params.from ? Date.parse(params.from) : undefined,
      to: params.to ? Date.parse(params.to) : undefined,
    },
    page,
  )

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.audit.title')}</h1>
        <p className="mono mt-1 text-xs text-[var(--muted)]">{result.total}</p>
      </header>
      <AuditTable
        locale={locale}
        events={result.rows.map((row) => ({
          id: row.id,
          actorLabel: row.actor_label,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          ip: row.ip,
          createdAt: new Date(row.created_at).toISOString(),
          metadata: safeParse(row.metadata),
        }))}
        page={buildPageMeta(result.total, page)}
      />
    </div>
  )
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Display-only: a hand-edited metadata blob degrades to "no details".
    return {}
  }
}
