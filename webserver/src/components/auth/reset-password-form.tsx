'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { PasswordStrength } from '@/components/auth/password-strength'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/** Reset confirmation form: new password twice, then sign in again. */
export function ResetPasswordForm({ locale, token }: { locale: Locale; token: string }) {
  const tt = translator(locale)
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password !== confirm) {
      setErrors({ confirm: '两次输入的口令不一致' })
      return
    }
    setLoading(true)
    setErrors({})
    try {
      await api.post('/api/v1/auth/password/reset/confirm', { token, newPassword: password })
      toast.success(tt('auth.reset.done'))
      router.replace('/login')
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fields = thrown.fieldErrors()
        setErrors(Object.keys(fields).length > 0 ? fields : { form: errorMessage(thrown.code, locale) })
      } else {
        setErrors({ form: tt('errors.network') })
      }
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label={tt('account.security.new')} htmlFor="newPassword" required error={errors.newPassword}>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={Boolean(errors.newPassword)}
        />
        <PasswordStrength password={password} />
      </Field>

      <Field label={tt('account.security.confirm')} htmlFor="confirm" required error={errors.confirm}>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          invalid={Boolean(errors.confirm)}
        />
      </Field>

      {errors.form ? (
        <p
          role="alert"
          className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]"
        >
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        {tt('auth.reset.submit')}
      </Button>
    </form>
  )
}
