'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api/client'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Confirms a deletion from a mailed link.
 *
 * Unlike verification this is NOT automatic: the whole point of a confirmation step
 * is that a human reads it. (An auto-consuming panel would let a mail scanner
 * schedule a deletion.) The user presses the button; the server then puts the
 * account into its grace period, which is cancellable from the account centre.
 */
export function DeletionConfirmPanel({ locale, token }: { locale: Locale; token: string }) {
  const tt = translator(locale)
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const submit = async () => {
    setState('working')
    try {
      const result = await api.post<{ scheduledFor: string }>('/api/v1/auth/deletion/confirm', {
        token,
      })
      setScheduledFor(result.scheduledFor)
      setState('done')
    } catch (thrown) {
      setMessage(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
      setState('failed')
    }
  }

  if (state === 'done') {
    // Derived from the deadline the server just returned, never a literal: a
    // deployment that changed `account.deletionGraceHours` would otherwise tell the
    // user "72 小时" while scheduling 24 or 720.
    const graceHours = scheduledFor
      ? Math.max(1, Math.round((new Date(scheduledFor).getTime() - Date.now()) / 3_600_000))
      : 0
    return (
      <div className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-3">
        <p className="text-sm text-[var(--danger)]">
          {tt('account.danger.scheduledFor', {
            date: scheduledFor ? new Date(scheduledFor).toLocaleString(locale) : '—',
          })}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {tt('account.danger.graceNotice', { hours: graceHours })}
        </p>
        <Link href="/account" className="mt-3 inline-block text-xs text-[var(--accent)] hover:underline">
          {tt('account.danger.cancelRequest')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)]">{tt('account.danger.requestRealDesc')}</p>
      {state === 'failed' && (
        <p className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {message}
        </p>
      )}
      <Button
        variant="danger"
        loading={state === 'working'}
        onClick={() => void submit()}
      >
        {tt('account.danger.delete')}
      </Button>
      <Link href="/account" className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
        {tt('common.cancel')}
      </Link>
    </div>
  )
}
