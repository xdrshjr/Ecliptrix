'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Laptop, Smartphone, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ApiError } from '@/lib/api/client'
import { sessionsApi, type SessionDto } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { RelativeTime } from '@/components/shell/relative-time'

/**
 * Device lists.
 *
 * One component for "my devices" and, through `scope`, for an administrator
 * looking at someone else's sessions. The two differ only in which endpoint
 * revokes a session, so splitting them would duplicate the row layout and let
 * the two drift.
 */
export interface SessionListProps {
  locale: Locale
  sessions: SessionDto[]
  /** `mine` uses `/me/sessions`; `admin` uses `/admin/sessions`. */
  scope?: 'mine' | 'admin'
  /** Hide the revoke button entirely (read-only roles). */
  canRevoke?: boolean
}

export function SessionList({ locale, sessions, scope = 'mine', canRevoke = true }: SessionListProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [revoking, setRevoking] = useState<string | null>(null)

  const revoke = async (id: string) => {
    setRevoking(id)
    try {
      if (scope === 'admin') await sessionsApi.revokeForUser(id)
      else await sessionsApi.revokeMine(id)
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

  if (sessions.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{tt('common.none')}</p>
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {sessions.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-[var(--muted)]">
              {item.client === 'desktop' ? <Smartphone size={15} /> : <Laptop size={15} />}
            </span>
            <div>
              <p className="flex items-center gap-2 text-sm">
                {item.deviceName || item.platform || item.client}
                {item.current ? (
                  <Badge tone="accent">{tt('account.security.currentDevice')}</Badge>
                ) : null}
              </p>
              <p className="mono text-xs text-[var(--muted)]">
                {item.ip || '—'} · <RelativeTime iso={item.lastSeenAt} locale={locale} />
              </p>
            </div>
          </div>
          {canRevoke && !item.current ? (
            <Button
              variant="ghost"
              size="sm"
              loading={revoking === item.id}
              onClick={() => revoke(item.id)}
              icon={<Trash2 size={13} />}
            >
              {scope === 'admin' ? tt('admin.users.revoke') : tt('account.security.revoke')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
