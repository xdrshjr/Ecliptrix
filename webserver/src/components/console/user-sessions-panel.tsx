'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { sessionsApi, type SessionDto } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { RelativeTime } from '@/components/shell/relative-time'

/**
 * An administrator's view of one user's devices.
 *
 * Read-only when the caller lacks `sessions.revoke`: the panel still answers
 * "who is signed in as this person", which is the first question in every
 * account-compromise report.
 *
 * The three extra columns are the device-identity ones (`platform`,
 * `appVersion`, `deviceKey` prefix). They are what makes "this person is signed
 * in from two machines" distinguishable from "one machine signed in five times",
 * because the server retires the previous session of the same `deviceKey`.
 */
export interface UserSessionsPanelProps {
  locale: Locale
  sessions: SessionDto[]
  canRevoke: boolean
}

/** First 8 characters: enough to correlate two rows, useless as a credential. */
function deviceKeyPrefix(deviceKey?: string): string {
  if (!deviceKey) return '—'
  return deviceKey.slice(0, 8)
}

export function UserSessionsPanel({ locale, sessions, canRevoke }: UserSessionsPanelProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [revoking, setRevoking] = useState<string | null>(null)
  const rows = sessions

  const revoke = async (id: string) => {
    setRevoking(id)
    try {
      await sessionsApi.revokeForUser(id)
      toast.success(tt('account.security.revoked'))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setRevoking(null)
    }
  }

  return (
    <section
      aria-labelledby="user-sessions-heading"
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h2 id="user-sessions-heading" className="text-sm font-medium">
        {tt('admin.users.sessions')}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{tt('common.none')}</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <th scope="col" className="py-2 pr-3 font-medium">
                {tt('admin.sessions.device')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {tt('admin.sessions.platform')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {tt('admin.sessions.appVersion')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {tt('admin.sessions.deviceKey')}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {tt('admin.sessions.lastSeen')}
              </th>
              <th scope="col" className="py-2 font-medium">
                {tt('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((item) => (
              <tr key={item.id}>
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-2">
                    {item.deviceName || item.client}
                    {item.current ? (
                      <Badge tone="accent">{tt('account.security.currentDevice')}</Badge>
                    ) : null}
                  </span>
                  <span className="mono text-xs text-[var(--muted)]">{item.ip || '—'}</span>
                </td>
                <td className="py-3 pr-3 text-[var(--muted)]">{item.platform || '—'}</td>
                <td className="mono py-3 pr-3 text-[var(--muted)]">{item.appVersion || '—'}</td>
                {/* Prefix only: the full key identifies a machine, not the person. */}
                <td className="mono py-3 pr-3 text-[var(--muted)]">
                  {deviceKeyPrefix(item.deviceKey)}
                </td>
                <td className="py-3 pr-3 text-[var(--muted)]">
                  <RelativeTime iso={item.lastSeenAt} locale={locale} />
                </td>
                <td className="py-3">
                  {canRevoke && !item.current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={revoking === item.id}
                      onClick={() => revoke(item.id)}
                      icon={<Trash2 size={13} />}
                    >
                      {tt('admin.users.revoke')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
