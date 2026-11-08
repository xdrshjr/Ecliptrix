'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Reset request form.
 *
 * The success state is shown even when the address is unknown — the server
 * answers `202` either way, and a distinct "no such account" message here would
 * undo the whole enumeration defence on the server side.
 */
export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const tt = translator(locale)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/api/v1/auth/password/reset/request', { email: email.trim() })
      setSent(true)
    } catch (thrown) {
      setError(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-sm border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-3 text-sm text-[var(--accent)]"
      >
        {tt('auth.forgot.sent')}
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label={tt('common.email')} htmlFor="email" required error={error ?? undefined}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          invalid={Boolean(error)}
          placeholder="you@example.com"
        />
      </Field>
      <Button type="submit" loading={loading} className="w-full">
        {tt('auth.forgot.submit')}
      </Button>
    </form>
  )
}
