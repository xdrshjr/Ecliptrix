'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input } from '@/components/ui/field'
import { PasswordStrength } from '@/components/auth/password-strength'
import { SessionList } from '@/components/account/session-list'
import { api, ApiError } from '@/lib/api/client'
import type { SessionDto } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Security panel: change password and manage devices.
 *
 * Changing the password with "sign out other devices" is the recovery path for a
 * leaked laptop, so it is a first-class checkbox rather than a hidden option.
 */
export interface SecurityPanelProps {
  locale: Locale
  sessions: SessionDto[]
  mustChangePassword: boolean
}

export function SecurityPanel({ locale, sessions, mustChangePassword }: SecurityPanelProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (next !== confirm) {
      setErrors({ confirm: '两次输入的口令不一致' })
      return
    }
    setBusy(true)
    setErrors({})
    try {
      await api.post('/api/v1/auth/password/change', {
        currentPassword: current,
        newPassword: next,
        signOutOtherSessions: signOutOthers,
      })
      toast.success(tt('account.security.changed'))
      setCurrent('')
      setNext('')
      setConfirm('')
      router.refresh()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fields = thrown.fieldErrors()
        setErrors(
          Object.keys(fields).length > 0 ? fields : { form: errorMessage(thrown.code, locale) },
        )
      } else {
        setErrors({ form: tt('errors.network') })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {mustChangePassword ? (
        <p
          role="status"
          className="rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--warning)]"
        >
          {tt('errors.password_change_required')}
        </p>
      ) : null}

      <section
        aria-labelledby="password-heading"
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <h2 id="password-heading" className="text-sm font-medium">
          {tt('common.password')}
        </h2>
        <form onSubmit={changePassword} className="mt-4 flex flex-col gap-4" noValidate>
          <Field
            label={tt('account.security.current')}
            htmlFor="currentPassword"
            required
            error={errors.currentPassword}
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              invalid={Boolean(errors.currentPassword)}
            />
          </Field>

          <Field
            label={tt('account.security.new')}
            htmlFor="newPassword"
            required
            error={errors.newPassword}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
              invalid={Boolean(errors.newPassword)}
            />
            <PasswordStrength password={next} />
          </Field>

          <Field
            label={tt('account.security.confirm')}
            htmlFor="confirmPassword"
            required
            error={errors.confirm}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              invalid={Boolean(errors.confirm)}
            />
          </Field>

          <Checkbox
            id="signOutOthers"
            label={tt('account.security.signOutOthers')}
            checked={signOutOthers}
            onChange={(event) => setSignOutOthers(event.target.checked)}
          />

          {errors.form ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {errors.form}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              {tt('common.save')}
            </Button>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="devices-heading"
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <h2 id="devices-heading" className="text-sm font-medium">
          {tt('account.security.devices')}
        </h2>
        <div className="mt-3">
          <SessionList locale={locale} sessions={sessions} />
        </div>
      </section>
    </div>
  )
}
