import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import * as mailService from '@/server/services/mailService'
import { maskEmail } from '@/server/services/privacy'
import { MailTable } from '@/components/console/mail-table'

/**
 * `/admin/mail` — the outbox.
 *
 * Read permission is `settings.read` (mail configuration and mail observability are
 * the same concern); the retry button needs `users.write`, which is checked here so
 * the UI never renders an action the caller cannot perform.
 *
 * The whole point of this page is the question "did that mail actually go out?" —
 * including on a deployment with no SMTP, where every row stays `captured`.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

const STATUSES = ['captured', 'sent', 'failed'] as const

export default async function AdminMailPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'settings.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)

  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, Number(params.pageSize ?? '20') || 20))
  const status = STATUSES.find((value) => value === params.status)

  const result = outboxRepo.list(
    getDb(),
    { status, template: params.template },
    { page, pageSize, offset: (page - 1) * pageSize },
  )

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">{tt('admin.mail.title')}</h1>
      </header>
      <MailTable
        locale={locale}
        rows={result.rows.map((row) => ({
          id: row.id,
          template: row.template,
          toMasked: maskEmail(row.to_email),
          status: row.status,
          attempts: row.attempts,
          retryable: row.retryable === 1,
          lastError: row.last_error,
          createdAt: new Date(row.created_at).toISOString(),
          sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        }))}
        total={result.total}
        page={page}
        pageSize={pageSize}
        status={status ?? ''}
        template={params.template ?? ''}
        canRetry={can(session, 'users.write')}
        capabilities={mailService.capabilities()}
      />
    </div>
  )
}
