'use client'

import { SessionList } from '@/components/account/session-list'
import type { SessionDto } from '@/lib/api/endpoints'
import { translator, type Locale } from '@/lib/i18n'

/**
 * An administrator's view of one user's devices.
 *
 * Read-only when the caller lacks `sessions.revoke`: the panel still answers
 * "who is signed in as this person", which is the first question in every
 * account-compromise report.
 */
export interface UserSessionsPanelProps {
  locale: Locale
  sessions: SessionDto[]
  canRevoke: boolean
}

export function UserSessionsPanel({ locale, sessions, canRevoke }: UserSessionsPanelProps) {
  const tt = translator(locale)

  return (
    <section
      aria-labelledby="user-sessions-heading"
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h2 id="user-sessions-heading" className="text-sm font-medium">
        {tt('admin.users.sessions')}
      </h2>
      <div className="mt-3">
        <SessionList
          locale={locale}
          sessions={sessions}
          scope="admin"
          canRevoke={canRevoke}
        />
      </div>
    </section>
  )
}
