import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import * as sessionService from '@/server/services/sessionService'
import { toSessionDto } from '@/server/db/types'
import { SecurityPanel } from '@/components/account/security-panel'

/** Account centre — password change and device sessions. */
export const dynamic = 'force-dynamic'

export default async function AccountSecurityPage() {
  const session = await currentSession()
  if (!session) redirect('/login')

  const locale = await resolveLocale()
  const tt = translator(locale)
  const sessions = sessionService.listForUser(session.user.id).map((row) =>
    toSessionDto(row, session.session.id),
  )

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('account.security')}</h1>
      </header>
      <SecurityPanel locale={locale} sessions={sessions} mustChangePassword={session.user.must_change_password === 1} />
    </div>
  )
}
