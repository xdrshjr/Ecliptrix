'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Consumes a mailed verification token on mount.
 *
 * Deliberately client-side: the mail scanner that pre-fetches every link in a
 * message would burn a token if the GET itself consumed it. The page renders, then
 * this panel POSTs — the same rule the password-reset page follows.
 *
 * Three outcomes, and the copy differs for each because the user's next action
 * differs: success, success-with-address-change (other devices signed out), and
 * invalid / expired / already used.
 *
 * There is deliberately NO "already verified" branch: `POST /auth/email/verify`
 * answers one `400 token_invalid` for unknown, expired, used and wrong-purpose
 * tokens (spec §3.4 — telling them apart is a token oracle). A branch keyed on
 * `email_already_verified` could therefore never run, and its copy would claim a
 * precision the endpoint refuses to give.
 */
export function EmailVerifyPanel({ locale, token }: { locale: Locale; token: string }) {
  const tt = translator(locale)
  const [state, setState] = useState<'working' | 'done' | 'changed' | 'failed'>('working')
  const [sessionsRevoked, setSessionsRevoked] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const result = await api.post<{
          email: string
          verifiedAt: string
          changed: boolean
          sessionsRevoked?: number
        }>('/api/v1/auth/email/verify', { token })
        if (cancelled) return
        setSessionsRevoked(result.sessionsRevoked ?? 0)
        setState(result.changed ? 'changed' : 'done')
      } catch {
        if (cancelled) return
        setState('failed')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  if (state === 'working') {
    return <p className="text-sm text-[var(--muted)]">{tt('common.loading')}</p>
  }

  if (state === 'failed') {
    return (
      <div className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-3">
        <p className="flex items-center gap-2 text-sm text-[var(--danger)]">
          <XCircle size={14} /> {tt('verify.invalid')}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">{tt('verify.expired')}</p>
        <Link
          href="/login"
          className="mt-3 inline-block text-xs text-[var(--accent)] hover:underline"
        >
          {tt('verify.resend')}
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-sm border border-[var(--accent)]/35 bg-[var(--accent)]/5 px-3 py-3">
      <p className="flex items-center gap-2 text-sm text-[var(--accent)]">
        <CheckCircle2 size={14} />
        {state === 'changed' ? tt('verify.successChanged') : tt('verify.success')}
      </p>
      {sessionsRevoked > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {tt('verify.sessionsRevoked', { count: sessionsRevoked })}
        </p>
      )}
      <div className="mt-3">
        <Link href="/account">
          <Button size="sm">{tt('verify.backToAccount')}</Button>
        </Link>
      </div>
    </div>
  )
}
