import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { getDb } from '@/server/db/client'
import { listForUser } from '@/server/db/repositories/auditRepo'
import { ActivityTimeline } from '@/components/account/activity-timeline'

/** Account centre — my last 90 days of whitelisted audit events. */
export const dynamic = 'force-dynamic'

export default async function AccountActivityPage() {
  const session = await currentSession()
  if (!session) redirect('/login')

  const locale = await resolveLocale()
  const tt = translator(locale)

  const { rows } = listForUser(getDb(), session.user.id, Date.now() - 90 * 24 * 60 * 60 * 1000, {
    page: 1,
    pageSize: 50,
    offset: 0,
  })

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('account.activity')}</h1>
      </header>
      <ActivityTimeline
        locale={locale}
        events={rows.map((row) => ({
          id: row.id,
          action: row.action,
          ip: row.ip,
          createdAt: new Date(row.created_at).toISOString(),
        }))}
      />
    </div>
  )
}
